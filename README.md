# Sismos en mi zona

PWA instalable que envía notificaciones push cuando el Servicio Geológico
Colombiano (SGC) reporta un sismo dentro del octágono marcado sobre el Eje
Cafetero, norte del Valle, Tolima y oriente del Chocó.

## Cómo funciona

```
feed SGC (5 días, todas las magnitudes)
        │  cada minuto
        ▼
revisar-sismos (función programada Netlify)
  ├─ filtra por polígono (lib/zona.mjs)
  ├─ compara con los ya vistos (Netlify Blobs "estado")
  └─ Web Push a cada dispositivo según su umbral (Blobs "suscripciones")
        ▼
sw.js muestra la notificación aunque la app esté cerrada
```

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

## Ajustes

- **Zona:** vértices en `netlify/functions/lib/zona.mjs`. Verifica con `npm run test:zona`.
- **Punto de distancia:** `REFERENCIA` en el mismo archivo (hoy Pereira).
- **Re-aviso por corrección:** `CORRECCION_MINIMA` en `revisar-sismos.mjs` (±0.5).
- **Frecuencia:** `schedule` en `revisar-sismos.mjs` (mínimo 1 minuto en Netlify).

## Detalles que hay que saber

- El feed del SGC entrega coordenadas como `[lat, lon, prof]`, no en orden GeoJSON.
  `zona.mjs` detecta el orden por rango.
- iPhone: push solo con iOS 16.4+ y la app agregada a la pantalla de inicio.
- Android: algunas marcas (Xiaomi, Huawei, Samsung con ahorro agresivo) retrasan
  pushes; excluye Chrome de la optimización de batería.
- No es alerta temprana: llega minutos después del sismo, cuando el SGC lo publica.
