import { json } from './lib/push.mjs';
import { leerLlaves } from './lib/vapid.mjs';

// Entrega la llave pública SOLO si el par está bien configurado: si no, el
// teléfono se suscribiría con una llave con la que el servidor no puede firmar.
export default async () => {
  const ll = leerLlaves();
  if (!ll.ok) return json({ error: ll.error, codigo: 'vapid-invalida' }, 500);
  return json({ publicKey: ll.publica });
};

export const config = { path: '/api/vapid' };
