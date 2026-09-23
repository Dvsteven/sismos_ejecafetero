import webpush from 'web-push';
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

export function configurarVapid() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error('Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en las variables de entorno');
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:alertas@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  return webpush;
}

export const tiendaSuscripciones = () => getStore({ name: 'suscripciones', consistency: 'strong' });
export const tiendaEstado = () => getStore({ name: 'estado', consistency: 'strong' });

export const claveDe = (endpoint) => createHash('sha256').update(endpoint).digest('base64url');

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** Envía un push. Devuelve 'ok', 'caducada' (hay que borrarla) o 'error'. */
export async function enviar(wp, suscripcion, payload) {
  try {
    await wp.sendNotification(suscripcion, JSON.stringify(payload), {
      TTL: 60 * 60 * 6,
      urgency: payload.urgente ? 'high' : 'normal',
    });
    return 'ok';
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) return 'caducada';
    console.error('Push falló', e.statusCode, e.body);
    return 'error';
  }
}

export function payloadDeSismo(s, { corregido = false } = {}) {
  const mag = s.mag.toFixed(1);
  const hora = s.local ? s.local.slice(11, 16) : '';
  const prof = s.profKm != null ? `${s.profKm} km de profundidad` : 'Profundidad sin dato';
  const partes = [
    hora && `${hora} hora local`,
    prof,
    `a ${s.distanciaKm} km de Pereira`,
  ].filter(Boolean);
  return {
    title: `${corregido ? 'Magnitud corregida: ' : 'Sismo '}M${mag}, ${s.lugar}`,
    body: partes.join(', ') + (s.revisado ? '.' : '. Dato automático, puede cambiar.'),
    tag: s.id,
    urgente: s.mag >= 4,
    url: `/?sismo=${encodeURIComponent(s.id)}`,
    mag: s.mag,
  };
}
