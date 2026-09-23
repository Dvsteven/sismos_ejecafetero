// API de canales de aviso (todo lo que no es push del navegador).
//
// GET  /api/canales                 -> qué canales ofrece el servidor
// POST /api/canales/telegram        { minMag }          -> { clave, token, enlace }
// POST /api/canales/correo          { email, minMag }   -> { clave, token } y envía confirmación
// POST /api/canales/ntfy            { minMag }          -> { clave, token, topic, enlace }
// POST /api/canales/estado          { items:[{clave,token}] } -> estado de cada uno
// POST /api/canales/umbral          { items:[{clave,token}], minMag }
// POST /api/canales/quitar          { clave, token }
// GET  /api/canales/confirmar?k=&c= -> confirma un correo (página HTML)
// GET  /api/canales/baja?k=&t=      -> baja desde el enlace del correo (página HTML)
import { json, tiendaSuscripciones } from './lib/push.mjs';
import {
  aleatorio, hash, urlSitio, canalesDisponibles, nombreBot, enviarCorreo, enviarNtfy,
  plantillaCorreo, CORREO_MIN_MAG, NTFY_SERVIDOR,
} from './lib/canales.mjs';

const tienda = () => tiendaSuscripciones();
const umbral = (v) => Math.max(0, Math.min(9, Number(v) || 0));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function autorizado(clave, token) {
  if (!clave || !token || typeof clave !== 'string') return null;
  const reg = await tienda().get(clave, { type: 'json' });
  return reg && reg.token === token ? reg : null;
}

function pagina(titulo, texto) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${titulo}</title></head>
    <body style="margin:0;font-family:system-ui,sans-serif;background:#13293D;color:#fff;display:grid;place-items:center;min-height:100vh;padding:24px">
    <main style="max-width:28rem"><h1 style="font-size:1.8rem;margin:0 0 .5rem">${titulo}</h1>
    <p style="color:#B9C9D6;line-height:1.5">${texto}</p>
    <a href="/" style="color:#fff;font-weight:bold">Abrir la app</a></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

const acciones = {
  async 'GET:'() {
    return json(await canalesDisponibles());
  },

  async 'POST:telegram'(cuerpo) {
    const bot = await nombreBot();
    if (!bot) return json({ error: 'Telegram no está configurado en el servidor' }, 503);
    const clave = `tg-${aleatorio(9)}`;
    const token = aleatorio(18);
    await tienda().setJSON(clave, {
      canal: 'telegram', destino: null, minMag: umbral(cuerpo.minMag),
      confirmado: false, token, creado: new Date().toISOString(), etiqueta: 'Telegram',
    });
    return json({ clave, token, enlace: `https://t.me/${bot}?start=${clave}`, bot });
  },

  async 'POST:correo'(cuerpo) {
    if (!process.env.RESEND_API_KEY) return json({ error: 'El correo no está configurado en el servidor' }, 503);
    const email = String(cuerpo.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: 'Escribe un correo válido' }, 400);

    // Índice por correo: evita duplicados y que alguien use el formulario
    // para llenar de correos de confirmación a otra persona.
    const indice = `idx-correo-${hash(email)}`;
    const previo = await tienda().get(indice, { type: 'json' });
    if (previo) {
      const reg = await tienda().get(previo.clave, { type: 'json' });
      if (reg?.confirmado) return json({ error: 'Ese correo ya recibe avisos. Para darlo de baja usa el enlace al final de cualquier aviso.' }, 409);
      if (reg && Date.now() - new Date(reg.creado).getTime() < 10 * 60e3) {
        return json({ error: 'Ya enviamos una confirmación a ese correo hace poco. Revisa también la carpeta de spam.' }, 429);
      }
    }

    const clave = `mail-${aleatorio(9)}`;
    const token = aleatorio(18);
    const codigo = aleatorio(18);
    await tienda().setJSON(clave, {
      canal: 'correo', destino: email, minMag: umbral(cuerpo.minMag), confirmado: false,
      token, codigo, creado: new Date().toISOString(), etiqueta: email,
    });
    await tienda().setJSON(indice, { clave });

    const enlace = `${urlSitio()}/api/canales/confirmar?k=${clave}&c=${codigo}`;
    const r = await enviarCorreo({
      para: email,
      asunto: 'Confirma tus avisos de sismos',
      texto: `Toca este enlace para empezar a recibir avisos de sismos en tu zona: ${enlace}\n\nSi no lo pediste, ignora este correo.`,
      html: plantillaCorreo({
        titulo: 'Confirma tus avisos de sismos',
        cuerpo: `Vas a recibir un correo cada vez que el Servicio Geológico Colombiano reporte un sismo de magnitud ${Math.max(CORREO_MIN_MAG, umbral(cuerpo.minMag)).toFixed(1)} o más en la zona.`,
        enlace,
        textoEnlace: 'Confirmar mi correo',
        pie: 'Si no pediste esto, ignora este mensaje y no recibirás nada.',
      }),
    });
    if (!r.ok) {
      await tienda().delete(clave);
      await tienda().delete(indice);
      return json({ error: `No se pudo enviar el correo (${r.status}): ${r.detalle ?? 'error de Resend'}` }, 502);
    }
    return json({ clave, token, minMag: Math.max(CORREO_MIN_MAG, umbral(cuerpo.minMag)) });
  },

  async 'POST:ntfy'(cuerpo) {
    // Nombre de tema largo y aleatorio: en ntfy.sh cualquiera que conozca el
    // nombre puede leerlo, así que no debe ser adivinable.
    const topic = `sismos-${aleatorio(9).replace(/[^A-Za-z0-9]/g, 'x')}`;
    const clave = `ntfy-${aleatorio(9)}`;
    const token = aleatorio(18);
    await tienda().setJSON(clave, {
      canal: 'ntfy', destino: topic, minMag: umbral(cuerpo.minMag), confirmado: true,
      token, creado: new Date().toISOString(), etiqueta: 'ntfy',
    });
    // Mensaje de bienvenida: ntfy.sh lo guarda 12 h, así aparece al suscribirse.
    await enviarNtfy(topic, {
      titulo: 'Avisos de sismos activos',
      mensaje: 'Por aquí te llegarán los sismos de tu zona.',
      prioridad: 3,
      etiquetas: ['white_check_mark'],
      clic: urlSitio() || undefined,
    }).catch(() => {});
    return json({ clave, token, topic, enlace: `${NTFY_SERVIDOR}/${topic}` });
  },

  async 'POST:estado'(cuerpo) {
    const items = Array.isArray(cuerpo.items) ? cuerpo.items.slice(0, 10) : [];
    const estados = await Promise.all(
      items.map(async ({ clave, token }) => {
        const reg = await autorizado(clave, token);
        if (!reg) return { clave, existe: false };
        return {
          clave, existe: true, canal: reg.canal, confirmado: reg.confirmado,
          minMag: reg.minMag, etiqueta: reg.etiqueta, destino: reg.canal === 'ntfy' ? reg.destino : undefined,
        };
      }),
    );
    return json({ estados });
  },

  async 'POST:umbral'(cuerpo) {
    const items = Array.isArray(cuerpo.items) ? cuerpo.items.slice(0, 10) : [];
    const minMag = umbral(cuerpo.minMag);
    await Promise.all(
      items.map(async ({ clave, token }) => {
        const reg = await autorizado(clave, token);
        if (reg) await tienda().setJSON(clave, { ...reg, minMag });
      }),
    );
    return json({ ok: true, minMag });
  },

  async 'POST:quitar'(cuerpo) {
    const reg = await autorizado(cuerpo.clave, cuerpo.token);
    if (!reg) return json({ ok: true }); // ya no existe
    await tienda().delete(cuerpo.clave);
    if (reg.canal === 'correo') await tienda().delete(`idx-correo-${hash(reg.destino)}`);
    return json({ ok: true });
  },

  async 'GET:confirmar'(_, url) {
    const clave = url.searchParams.get('k');
    const reg = clave ? await tienda().get(clave, { type: 'json' }) : null;
    if (!reg || reg.canal !== 'correo' || reg.codigo !== url.searchParams.get('c')) {
      return pagina('Enlace no válido', 'Este enlace expiró o ya no existe. Vuelve a activar el correo desde la app.');
    }
    if (!reg.confirmado) await tienda().setJSON(clave, { ...reg, confirmado: true, codigo: null });
    return pagina('Correo confirmado', `Desde ahora recibirás en ${reg.destino} los sismos de la zona de magnitud ${Math.max(CORREO_MIN_MAG, reg.minMag).toFixed(1)} o más.`);
  },

  async 'GET:baja'(_, url) {
    const clave = url.searchParams.get('k');
    const reg = await autorizado(clave, url.searchParams.get('t'));
    if (reg) {
      await tienda().delete(clave);
      if (reg.canal === 'correo') await tienda().delete(`idx-correo-${hash(reg.destino)}`);
    }
    return pagina('Listo, no recibirás más correos', 'Tu correo quedó dado de baja. Puedes volver a activarlo cuando quieras desde la app.');
  },
};

export default async (req, context) => {
  const url = new URL(req.url);
  const accion = context.params?.accion ?? '';
  const fn = acciones[`${req.method}:${accion}`];
  if (!fn) return json({ error: 'Ruta no encontrada' }, 404);
  const cuerpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  return fn(cuerpo, url);
};

export const config = { path: ['/api/canales', '/api/canales/:accion'] };
