import { json, tiendaSuscripciones, claveDe, configurarVapid, enviar } from './lib/push.mjs';

// Envía una notificación de prueba solo al dispositivo que la pide.
export default async (req) => {
  const { endpoint } = await req.json().catch(() => ({}));
  if (!endpoint) return json({ error: 'Falta endpoint' }, 400);
  const registro = await tiendaSuscripciones().get(claveDe(endpoint), { type: 'json' });
  if (!registro) return json({ error: 'Este dispositivo no está suscrito' }, 404);

  const resultado = await enviar(configurarVapid(), registro.subscription, {
    title: 'Prueba de alerta sísmica',
    body: 'Si ves esto, las alertas de tu zona llegarán a este dispositivo.',
    tag: 'prueba',
    url: '/',
    mag: 0,
  });
  if (resultado === 'caducada') await tiendaSuscripciones().delete(claveDe(endpoint));
  return json({ resultado }, resultado === 'ok' ? 200 : 502);
};

export const config = { path: '/api/probar', method: 'POST' };
