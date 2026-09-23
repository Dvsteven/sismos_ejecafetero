// Revisa la configuración del servidor. Abre /api/diagnostico en el navegador.
// No expone la llave privada: solo dice si corresponde a la pública.
import { leerLlaves } from './lib/vapid.mjs';
import { VERSION } from './lib/version.mjs';
import { json, tiendaSuscripciones } from './lib/push.mjs';
import { latidoVigente } from './lib/procesar.mjs';
import { obtenerSismos } from './lib/fuentes.mjs';
import { canalesDisponibles, canalDe } from './lib/canales.mjs';

export default async () => {
  const d = {};
  d.version = VERSION;
  const ll = leerLlaves();
  d.llavesVapid = ll.ok ? 'correctas' : `ERROR: ${ll.error}`;
  if (ll.avisos.length) d.avisosVapid = ll.avisos;
  d.contactoVapid = ll.ok ? ll.subject : '-';

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
    const { sismos, fuentes } = await obtenerSismos();
    d.fuentes = fuentes;
    d.ultimoSismo = sismos[0] ? `M${sismos[0].mag} ${sismos[0].lugar} (${sismos[0].fuente}, ${sismos[0].local})` : 'ninguno';
  } catch (e) {
    d.fuentes = `error: ${e.message}`;
  }

  return json(d);
};

export const config = { path: '/api/diagnostico' };
