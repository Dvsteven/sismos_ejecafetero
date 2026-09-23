# Sismos en mi zona

PWA instalable que envía notificaciones push cuando el Servicio Geológico
Colombiano (SGC) reporta un sismo dentro del octágono marcado sobre el Eje
Cafetero, norte del Valle, Tolima y oriente del Chocó.

## Cómo funciona

```
feed SGC (5 días, todas las magnitudes)
        │
        ├─ cada 12 s ──► worker (Railway / VPS)          ◄─ principal
        │                  escribe un latido cada 30 s
        │
        └─ cada 1 min ─► revisar-sismos (Netlify)         ◄─ respaldo
                           solo actúa si no hay latido reciente del worker
        ▼
lib/procesar.mjs (compartido)
  ├─ filtra por polígono (lib/zona.mjs)
  ├─ compara con los ya vistos (Netlify Blobs "estado")
  └─ Web Push a cada dispositivo según su umbral (Blobs "suscripciones")
        ▼
sw.js muestra la notificación aunque la app esté cerrada
```

El worker usa peticiones condicionales (ETag / If-Modified-Since): si el feed
no cambió, el SGC responde 304 sin reenviar el archivo.

| Ruta | Qué hace |
|---|---|
| `GET /api/sismos` | Sismos de la zona para la interfaz |
| `GET /api/vapid` | Llave pública para suscribirse |
| `POST/DELETE /api/suscripcion` | Alta/baja del dispositivo y su magnitud mínima |
| `POST /api/probar` | Notificación de prueba al dispositivo que la pide |

## Despliegue

1. `npm install`
2. `npm run vapid` y copia las 3 variables en Netlify → Site configuration →
   Environment variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
3. `netlify deploy --prod` (o conecta el repo en Netlify).
4. Abre el sitio en el celular, instálalo y toca **Activar alertas** → **Enviar prueba**.

La primera corrida de la función programada solo memoriza lo que ya está en el
feed (no notifica 5 días de golpe). Desde la segunda, avisa lo nuevo.

## Medios de aviso

Al tocar **Activar avisos**, cada persona elige por dónde recibirlos (puede
activar varios). Solo aparecen los medios configurados en el servidor.

| Medio | Configuración | Notas |
|---|---|---|
| Notificación del teléfono | `VAPID_*` | Requiere la app instalada en iPhone; falla con DNS privado que bloquee Google |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Comandos del bot: `/umbral 3`, `/stop` |
| Correo | `RESEND_API_KEY`, `CORREO_REMITENTE` | Confirmación obligatoria por enlace; solo desde `CORREO_MIN_MAG` (3 por defecto) |
| ntfy | ninguna | Tema aleatorio por persona en ntfy.sh |

Todas usan `SITE_URL` para los enlaces.

**Telegram:**
1. En Telegram, háblale a @BotFather → `/newbot` → copia el token.
2. Inventa un secreto (letras y números, ej. `openssl rand -hex 24`).
3. Pon `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` en Netlify y despliega.
4. Conecta el bot con el sitio una vez:
   `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... SITE_URL=https://... npm run telegram`

**Correo (Resend):**
1. Crea cuenta en resend.com y una API key.
2. Para enviar a otras personas debes verificar un dominio propio en Resend.
   Sin dominio, Resend solo deja enviar al correo de tu cuenta.
3. Pon `RESEND_API_KEY` y `CORREO_REMITENTE` (con ese dominio) en Netlify.
   El plan gratuito tiene límite diario: por eso el piso de M3.

Nadie puede dar de alta un correo ajeno sin acceso a ese buzón: el aviso solo
se activa al tocar el enlace de confirmación, y cada correo trae enlace de baja.

## Worker de tiempo real

Sin el worker todo sigue funcionando, con demora de hasta 1 minuto. Con él,
la demora baja a ~12 s más lo que tarde el SGC en publicar.

Necesita estas variables:

| Variable | De dónde sale |
|---|---|
| `NETLIFY_SITE_ID` | `netlify status` o Project configuration → General → Project ID |
| `NETLIFY_API_TOKEN` | Netlify → User settings → Applications → Personal access tokens |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Las mismas que pusiste en Netlify |
| `POLL_SECONDS` | Opcional, por defecto 12 (mínimo 5) |
| `SITE_URL`, `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `CORREO_REMITENTE` | Las mismas de Netlify, si usas esos medios |

**Railway (lo más simple):** sube el repo a GitHub, en Railway crea un proyecto
desde ese repo (detecta el `Dockerfile`), agrega las variables y listo. No
necesita puerto ni dominio.

**VPS propio:**
```bash
npm install --omit=dev
npm i -g pm2
NETLIFY_SITE_ID=... NETLIFY_API_TOKEN=... VAPID_PUBLIC_KEY=... \
VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... pm2 start worker/worker.mjs --name sismos
pm2 save && pm2 startup
```

**Local, para probar:** `npm run worker` con las variables exportadas.

Cómo saber que está vivo: en los logs de Netlify, la función `revisar-sismos`
deja de registrar envíos (se aparta porque ve el latido). Si apagas el worker,
en ~90 s la función retoma sola.

## Ajustes

- **Zona:** vértices en `netlify/functions/lib/zona.mjs`. Verifica con `npm run test:zona`.
- **Punto de distancia:** `REFERENCIA` en el mismo archivo (hoy Pereira).
- **Re-aviso por corrección:** `CORRECCION_MINIMA` en `lib/procesar.mjs` (±0.5 acumulado).
- **Frecuencia:** `POLL_SECONDS` en el worker; `schedule` del respaldo en `revisar-sismos.mjs`.
- **Fuente:** `FEED_URL` para apuntar a otro feed con el mismo formato.

## Detalles que hay que saber

- El feed del SGC entrega coordenadas como `[lat, lon, prof]`, no en orden GeoJSON.
  `zona.mjs` detecta el orden por rango.
- iPhone: push solo con iOS 16.4+ y la app agregada a la pantalla de inicio.
- Android: algunas marcas (Xiaomi, Huawei, Samsung con ahorro agresivo) retrasan
  pushes; excluye Chrome de la optimización de batería.
- No es alerta temprana: llega minutos después del sismo, cuando el SGC lo publica.
