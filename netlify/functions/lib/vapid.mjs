// Lectura robusta de las llaves VAPID desde las variables de entorno.
// Corrige los errores típicos al pegarlas en el panel de Netlify:
//   - comillas, espacios o saltos de línea alrededor
//   - pegar la línea completa "VAPID_PUBLIC_KEY=BNug..."
//   - base64 normal (+ / =) en vez de base64url
//   - pública y privada intercambiadas
// y valida que la pública corresponda a la privada.
import { createECDH } from 'node:crypto';

const limpiar = (v) =>
  String(v || '')
    .trim()
    .replace(/^[A-Z_]+\s*=\s*/, '') // "VAPID_PUBLIC_KEY=..."
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const bytes = (b64) => {
  try { return Buffer.from(b64, 'base64url'); } catch { return Buffer.alloc(0); }
};

export function leerLlaves() {
  let publica = limpiar(process.env.VAPID_PUBLIC_KEY);
  let privada = limpiar(process.env.VAPID_PRIVATE_KEY);
  const avisos = [];

  if (!publica || !privada) {
    return { ok: false, error: `Falta ${!publica ? 'VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY'} en las variables de entorno`, avisos };
  }

  // ¿Quedaron intercambiadas? La pública mide 65 bytes y la privada 32.
  if (bytes(publica).length === 32 && bytes(privada).length === 65) {
    [publica, privada] = [privada, publica];
    avisos.push('VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY estaban intercambiadas; se corrigió al leerlas, pero conviene arreglarlas en Netlify');
  }

  const bPub = bytes(publica);
  if (bPub.length !== 65 || bPub[0] !== 4) {
    return { ok: false, error: `VAPID_PUBLIC_KEY no es una llave pública válida (${bPub.length} bytes, deben ser 65). Genera un par nuevo con npm run vapid`, avisos };
  }
  const bPriv = bytes(privada);
  if (bPriv.length !== 32) {
    return { ok: false, error: `VAPID_PRIVATE_KEY no es válida (${bPriv.length} bytes, deben ser 32)`, avisos };
  }

  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(bPriv);
    if (!ecdh.getPublicKey().equals(bPub)) {
      return { ok: false, error: 'Las llaves VAPID no son del mismo par. Corre npm run vapid una sola vez y copia las dos de esa misma salida', avisos };
    }
  } catch (e) {
    return { ok: false, error: `VAPID_PRIVATE_KEY inválida: ${e.message}`, avisos };
  }

  const asunto = String(process.env.VAPID_SUBJECT || '').trim().replace(/^["']|["']$/g, '');
  const sitio = String(process.env.SITE_URL || process.env.URL || '').trim();
  const subject = /^(mailto:|https:\/\/)/.test(asunto) && !/ejemplo|example/.test(asunto)
    ? asunto
    : sitio.startsWith('https://') ? sitio : 'mailto:alertas@sismos.app';

  return { ok: true, publica, privada, subject, avisos };
}
