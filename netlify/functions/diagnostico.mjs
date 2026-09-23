// Revisa la configuración del servidor. Abre /api/diagnostico en el navegador.
// No expone la llave privada: solo dice si corresponde a la pública.
import { createECDH } from 'node:crypto';
import { json, tiendaSuscripciones } from './lib/push.mjs';
import { latidoVigente } from './lib/procesar.mjs';
import { descargarFeed, filtrarFeed } from './lib/zona.mjs';
import { canalesDisponibles, canalDe } from './lib/canales.mjs';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export default async () => {
  const { VAPID_PUBLIC_KEY: pub = '', VAPID_PRIVATE_KEY: priv = '', VAPID_SUBJECT: subj = '' } = process.env;
  const d = {};

  d.vapidPublica = pub ? `presente (${pub.length} caracteres, esperado 87)` : 'FALTA';
  d.vapidPrivada = priv ? `presente (${priv.length} caracteres, esperado 43)` : 'FALTA';
  d.espaciosOComillas = /["'\s]/.test(pub + priv) ? 'SÍ: quítalos de las variables' : 'no';

  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(priv.trim(), 'base64url'));
    d.parDeLlaves = b64url(ecdh.getPublicKey()) === pub.trim()
      ? 'correcto: la privada corresponde a la pública'
      : 'NO COINCIDEN: la privada es de otro par. Genera un par nuevo y pon ambas juntas';
  } catch (e) {
    d.parDeLlaves = `llave privada inválida: ${e.message}`;
  }

  d.vapidSubject = !subj
    ? 'FALTA (se usa uno genérico)'
    : /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subj) && !/ejemplo|example/.test(subj)
      ? 'correcto'
      : `revisar: "${subj}" debe ser mailto: con tu correo real`;

  d.canales = await canalesDisponibles().catch((e) => `error: ${e.message}`);
  d.sitio = process.env.SITE_URL || process.env.URL || 'FALTA SITE_URL (los enlaces de correo y Telegram no tendrán dominio)';

  try {
    const t = tiendaSuscripciones();
    const { blobs } = await t.list();
    const porCanal = {};
    for (const { key } of blobs) {
      if (key.startsWith('idx-')) continue;
      const reg = await t.get(key, { type: 'json' });
      const c = canalDe(reg) + (reg?.canal && !reg.confirmado ? ' (sin confirmar)' : '');
      porCanal[c] = (porCanal[c] || 0) + 1;
    }
    d.suscripciones = porCanal;
  } catch (e) {
    d.suscripciones = `error leyendo Blobs: ${e.message}`;
  }

  try {
    d.workerTiempoReal = (await latidoVigente()) ? 'activo' : 'inactivo (el respaldo de Netlify revisa cada minuto)';
  } catch {
    d.workerTiempoReal = 'sin dato';
  }

  try {
    const { feed } = await descargarFeed();
    d.feedSGC = `ok, ${feed.features.length} eventos, ${filtrarFeed(feed).length} en tu zona`;
  } catch (e) {
    d.feedSGC = `error: ${e.message}`;
  }

  return json(d);
};

export const config = { path: '/api/diagnostico' };
