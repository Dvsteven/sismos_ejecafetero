import webpush from 'web-push';
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { leerLlaves } from './vapid.mjs';

export function configurarVapid() {
  const ll = leerLlaves();
  if (!ll.ok) throw new Error(ll.error);
  webpush.setVapidDetails(ll.subject, ll.publica, ll.privada);
  return webpush;
}

// Dentro de Netlify, getStore se autentica solo. Fuera (el worker), usa el
// ID del sitio y un token personal; la API de Blobs ya es consistente.
function tienda(name) {
  const { NETLIFY_SITE_ID: siteID, NETLIFY_API_TOKEN: token } = process.env;
  return siteID && token ? getStore({ name, siteID, token }) : getStore({ name, consistency: 'strong' });
}
export const tiendaSuscripciones = () => tienda('suscripciones');
export const tiendaEstado = () => tienda('estado');

export const claveDe = (endpoint) => createHash('sha256').update(endpoint).digest('base64url');

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Envía un push. Devuelve { resultado, codigo, detalle } donde resultado es
 * 'ok', 'caducada' (hay que borrar la suscripción) o 'error'.
 */
export async function enviar(wp, suscripcion, payload) {
  try {
    await wp.sendNotification(suscripcion, JSON.stringify(payload), {
      TTL: 60 * 60 * 6,
      urgency: payload.urgente ? 'high' : 'normal',
    });
    return { resultado: 'ok' };
  } catch (e) {
    const codigo = e.statusCode ?? null;
    const detalle = String(e.body || e.message || '').slice(0, 300);
    if (codigo === 404 || codigo === 410) return { resultado: 'caducada', codigo, detalle };
    console.error('Push falló', codigo, detalle);
    return { resultado: 'error', codigo, detalle };
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
