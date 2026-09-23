import { json, tiendaSuscripciones, claveDe } from './lib/push.mjs';

// POST   { subscription, minMag } -> guarda o actualiza este dispositivo
// DELETE { endpoint }             -> lo da de baja
export default async (req) => {
  const tienda = tiendaSuscripciones();
  let cuerpo;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido' }, 400);
  }

  if (req.method === 'POST') {
    const sub = cuerpo?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return json({ error: 'Suscripción push incompleta' }, 400);
    }
    const minMag = Math.max(0, Math.min(9, Number(cuerpo.minMag) || 0));
    await tienda.setJSON(claveDe(sub.endpoint), {
      subscription: sub,
      minMag,
      actualizada: new Date().toISOString(),
    });
    return json({ ok: true, minMag });
  }

  if (req.method === 'DELETE') {
    if (!cuerpo?.endpoint) return json({ error: 'Falta endpoint' }, 400);
    await tienda.delete(claveDe(cuerpo.endpoint));
    return json({ ok: true });
  }

  return json({ error: 'Método no permitido' }, 405);
};

export const config = { path: '/api/suscripcion', method: ['POST', 'DELETE'] };
