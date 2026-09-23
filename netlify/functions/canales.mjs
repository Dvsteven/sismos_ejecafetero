// Canales de aviso. Cada suscriptor elige uno o varios:
//   push      notificación del navegador (PWA instalada)
//   telegram  mensaje de un bot de Telegram
//   correo    email vía Resend (con confirmación obligatoria)
//   ntfy      app gratuita ntfy.sh, sin cuenta
//
// Todos los registros viven en el store "suscripciones":
//   push:  { subscription, minMag }                      (formato original)
//   otros: { canal, destino, minMag, confirmado, token, creado, etiqueta }
import { randomBytes, createHash } from 'node:crypto';
import { configurarVapid, enviar as enviarPush } from './push.mjs';

export const aleatorio = (n = 12) => randomBytes(n).toString('base64url');
export const hash = (t) => createHash('sha256').update(t).digest('base64url').slice(0, 24);
export const urlSitio = () => (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');

// Por correo solo sismos desde esta magnitud: el plan gratuito de Resend
// permite ~100 correos al día y la zona tiene más de 30 sismos diarios.
export const CORREO_MIN_MAG = Number(process.env.CORREO_MIN_MAG ?? 3);
export const NTFY_SERVIDOR = (process.env.NTFY_SERVIDOR || 'https://ntfy.sh').replace(/\/$/, '');

export const canalDe = (reg) => reg?.canal ?? 'push';

// ---------- Telegram ----------
let botCache;
export async function telegram(metodo, cuerpo) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN');
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo ?? {}),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ...data };
}
export async function nombreBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  if (botCache) return botCache;
  const r = await telegram('getMe');
  botCache = r.ok ? r.result.username : null;
  return botCache;
}

// ---------- Correo (Resend) ----------
export async function enviarCorreo({ para, asunto, html, texto }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.CORREO_REMITENTE || 'Alertas de sismos <onboarding@resend.dev>',
      to: [para],
      subject: asunto,
      html,
      text: texto,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, detalle: data?.message };
}

const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function plantillaCorreo({ titulo, cuerpo, enlace, textoEnlace, pie }) {
  return `<!doctype html><html><body style="margin:0;background:#EEF2F3;font-family:Arial,sans-serif;color:#13293D">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#13293D;color:#fff;padding:20px 24px;border-left:6px solid #D7263D">
      <h1 style="margin:0;font-size:22px;line-height:1.25">${escapar(titulo)}</h1>
    </div>
    <div style="background:#fff;padding:20px 24px;font-size:16px;line-height:1.5">
      <p style="margin:0 0 16px">${escapar(cuerpo)}</p>
      ${enlace ? `<a href="${enlace}" style="display:inline-block;background:#D7263D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold">${escapar(textoEnlace)}</a>` : ''}
    </div>
    <p style="font-size:12px;color:#4A5E6E;padding:12px 4px">${pie}</p>
  </div></body></html>`;
}

// ---------- ntfy ----------
export async function enviarNtfy(topic, { titulo, mensaje, prioridad = 3, etiquetas = [], clic }) {
  const r = await fetch(`${NTFY_SERVIDOR}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title: titulo, message: mensaje, priority: prioridad, tags: etiquetas, click: clic }),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: r.ok, status: r.status };
}

// ---------- Despacho común ----------
/**
 * Envía un aviso por el canal del registro.
 * payload: { title, body, url, urgente, tag, mag }
 * Devuelve { resultado: 'ok' | 'caducada' | 'error', codigo?, detalle? }.
 */
export async function enviarPorCanal(clave, reg, payload, wp) {
  const canal = canalDe(reg);
  const enlace = `${urlSitio()}${payload.url || '/'}`;
  try {
    if (canal === 'push') {
      return await enviarPush(wp ?? configurarVapid(), reg.subscription, payload);
    }

    if (canal === 'telegram') {
      const r = await telegram('sendMessage', {
        chat_id: reg.destino,
        text: `${payload.urgente ? '🔴' : '🟠'} ${payload.title}\n${payload.body}\n\n${enlace}`,
        disable_web_page_preview: true,
        disable_notification: false,
      });
      if (r.ok) return { resultado: 'ok' };
      // 403: el usuario bloqueó el bot o borró el chat.
      if (r.status === 403 || r.status === 400) return { resultado: 'caducada', codigo: r.status, detalle: r.description };
      return { resultado: 'error', codigo: r.status, detalle: r.description };
    }

    if (canal === 'correo') {
      const baja = `${urlSitio()}/api/canales/baja?k=${encodeURIComponent(clave)}&t=${encodeURIComponent(reg.token)}`;
      const r = await enviarCorreo({
        para: reg.destino,
        asunto: payload.title,
        texto: `${payload.body}\n\n${enlace}\n\nDejar de recibir estos correos: ${baja}`,
        html: plantillaCorreo({
          titulo: payload.title,
          cuerpo: payload.body,
          enlace,
          textoEnlace: 'Ver en el mapa',
          pie: `Recibes esto porque activaste avisos de sismos por correo. <a href="${baja}" style="color:#4A5E6E">Dejar de recibirlos</a>.`,
        }),
      });
      if (r.ok) return { resultado: 'ok' };
      return { resultado: r.status === 422 ? 'caducada' : 'error', codigo: r.status, detalle: r.detalle };
    }

    if (canal === 'ntfy') {
      const r = await enviarNtfy(reg.destino, {
        titulo: payload.title,
        mensaje: payload.body,
        prioridad: payload.urgente ? 5 : payload.tag === 'prueba' ? 3 : 4,
        etiquetas: [payload.urgente ? 'rotating_light' : 'warning'],
        clic: enlace,
      });
      return r.ok ? { resultado: 'ok' } : { resultado: 'error', codigo: r.status };
    }

    return { resultado: 'error', detalle: `Canal desconocido: ${canal}` };
  } catch (e) {
    return { resultado: 'error', detalle: e.message };
  }
}

/** Mínimo efectivo para un registro (el correo tiene piso propio). */
export const umbralDe = (reg) =>
  canalDe(reg) === 'correo' ? Math.max(CORREO_MIN_MAG, reg.minMag ?? 0) : reg.minMag ?? 0;

/** Qué canales están configurados en el servidor. */
export async function canalesDisponibles() {
  return {
    push: Boolean(process.env.VAPID_PUBLIC_KEY),
    telegram: process.env.TELEGRAM_BOT_TOKEN ? { bot: await nombreBot().catch(() => null) } : false,
    correo: process.env.RESEND_API_KEY ? { minMag: CORREO_MIN_MAG } : false,
    ntfy: process.env.NTFY_DESACTIVADO ? false : { servidor: NTFY_SERVIDOR },
  };
}
