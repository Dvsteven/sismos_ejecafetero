import { json, tiendaSuscripciones, claveDe, configurarVapid, enviar } from './lib/push.mjs';
import { enviarPorCanal } from './lib/canales.mjs';

const PRUEBA = {
  title: 'Prueba de alerta sísmica',
  body: 'Si ves esto, los avisos de tu zona llegarán por este medio.',
  tag: 'prueba',
  url: '/',
  mag: 0,
};

// Envía una notificación de prueba solo al dispositivo que la pide y
// devuelve el motivo exacto si el servicio de push la rechaza.
export default async (req) => {
  const { endpoint, clave, token } = await req.json().catch(() => ({}));

  // Canales distintos al push del navegador: Telegram, correo, ntfy.
  if (clave) {
    const tienda = tiendaSuscripciones();
    const reg = await tienda.get(clave, { type: 'json' });
    if (!reg || reg.token !== token) return json({ error: 'Este aviso ya no existe. Vuelve a agregarlo.' }, 404);
    if (!reg.confirmado) return json({ error: 'Falta confirmar este aviso.' }, 409);
    const r = await enviarPorCanal(clave, reg, PRUEBA);
    if (r.resultado === 'ok') return json({ resultado: 'ok' });
    return json({ error: `No se pudo enviar (${r.codigo ?? 'sin código'}): ${r.detalle ?? 'error'}`, ...r }, 502);
  }

  if (!endpoint) return json({ error: 'Falta endpoint' }, 400);

  let wp;
  try {
    wp = configurarVapid();
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  const tienda = tiendaSuscripciones();
  const registro = await tienda.get(claveDe(endpoint), { type: 'json' });
  if (!registro) return json({ error: 'Este dispositivo no está registrado en el servidor. Desactiva y vuelve a activar.' }, 404);

  const r = await enviar(wp, registro.subscription, PRUEBA);

  if (r.resultado === 'ok') return json({ resultado: 'ok' });
  if (r.resultado === 'caducada') {
    await tienda.delete(claveDe(endpoint));
    return json({ error: 'La suscripción caducó. Desactiva y vuelve a activar las alertas.', ...r }, 410);
  }
  return json({ error: explicar(r), ...r }, 502);
};

function explicar({ codigo, detalle = '' }) {
  if (codigo === 403 && /vapid|credential|correspond/i.test(detalle)) {
    return 'Las llaves VAPID del servidor no coinciden con las usadas al suscribir. Revisa /api/diagnostico y reactiva las alertas.';
  }
  if (codigo === 403 && /BadJwtToken/i.test(detalle)) {
    return 'Apple rechazó la firma: revisa que VAPID_SUBJECT sea un mailto: con un correo real.';
  }
  if (codigo === 400) return `El servicio de push rechazó el mensaje (400): ${detalle}`;
  if (codigo === 401 || codigo === 403) return `El servicio de push rechazó la autorización (${codigo}): ${detalle}`;
  return `El servicio de push respondió ${codigo ?? 'sin código'}: ${detalle}`;
}

export const config = { path: '/api/probar', method: 'POST' };
