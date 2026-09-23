import { json } from './lib/push.mjs';

export default async () => {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!publicKey) return json({ error: 'El servidor no tiene VAPID_PUBLIC_KEY configurada' }, 500);
  return json({ publicKey });
};

export const config = { path: '/api/vapid' };
