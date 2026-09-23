// Lógica compartida entre la función programada de Netlify y el worker:
// compara los sismos del feed con los ya vistos y envía los push.
import { configurarVapid, payloadDeSismo, tiendaEstado, tiendaSuscripciones } from './push.mjs';
import { enviarPorCanal, umbralDe, canalDe } from './canales.mjs';
import { mismoSismo } from './fuentes.mjs';

// Nunca se avisa un sismo ocurrido hace más de esto: protege de avalanchas
// cuando una fuente vuelve después de estar caída o se agrega una nueva.
const MAX_EDAD_MS = 60 * 60 * 1000;

const UN_DIA = 24 * 3600 * 1000;

const SEIS_DIAS = 6 * 24 * 3600 * 1000;
export const CORRECCION_MINIMA = 0.5; // re-avisar si el SGC corrige la magnitud en ±0.5 o más

export async function procesarSismos(sismos, { origen = 'netlify' } = {}) {
  const estadoStore = tiendaEstado();
  const estado = await estadoStore.get('vistos', { type: 'json' });

  // Primera ejecución: memoriza lo que ya está en el feed sin notificar.
  if (!estado) {
    await estadoStore.setJSON(
      'vistos',
      Object.fromEntries(sismos.map((s) => [s.id, { mag: s.mag, utc: s.utc, lat: s.lat, lon: s.lon }])),
    );
    return { inicializado: true, avisos: 0, enviados: 0 };
  }

  const avisos = [];
  let cambios = false;
  for (const s of sismos) {
    const previo = estado[s.id];
    if (!previo) {
      // ¿Es un sismo que ya avisamos, pero reportado por otra agencia?
      const gemelo = Object.values(estado).some((v) => v.lat != null && mismoSismo(v, s));
      estado[s.id] = { mag: s.mag, utc: s.utc, lat: s.lat, lon: s.lon };
      cambios = true;
      if (gemelo) continue;
      if (Date.now() - new Date(s.utc).getTime() > MAX_EDAD_MS) continue; // viejo: solo registrar
      avisos.push({ sismo: s, umbral: s.mag, corregido: false });
    } else if (Math.abs(s.mag - previo.mag) >= CORRECCION_MINIMA) {
      // Corrección de la MISMA fuente (mismo id). Las diferencias entre
      // agencias no cuentan: cada una calcula la magnitud a su manera.
      avisos.push({ sismo: s, umbral: Math.max(s.mag, previo.mag), corregido: true });
      estado[s.id] = { ...previo, mag: s.mag };
      cambios = true;
    }
    // Cambios pequeños no se guardan: la referencia sigue siendo la
    // magnitud ya notificada, así correcciones chicas que suman ±0.5 avisan.
  }

  const limite = Date.now() - SEIS_DIAS;
  for (const [id, v] of Object.entries(estado)) {
    if (v.utc && new Date(v.utc).getTime() < limite) {
      delete estado[id];
      cambios = true;
    }
  }

  // Se guarda ANTES de enviar: si el proceso muere a mitad de envío, es
  // preferible perder un aviso a mandarlo dos veces en cada reintento.
  if (cambios) await estadoStore.setJSON('vistos', estado);
  if (!avisos.length) return { avisos: 0, enviados: 0 };

  avisos.reverse(); // del más antiguo al más reciente

  // Push solo necesita VAPID si hay suscriptores push; los demás canales no.
  let wp = null;
  try { wp = configurarVapid(); } catch (e) { console.error(e.message); }

  const subsStore = tiendaSuscripciones();
  const { blobs } = await subsStore.list();
  const registros = (
    await Promise.all(
      blobs
        .filter(({ key }) => !key.startsWith('idx-'))
        .map(async ({ key }) => ({ key, reg: await subsStore.get(key, { type: 'json' }) })),
    )
  ).filter(({ reg }) => reg);

  // Todos los suscriptores en paralelo; cada uno recibe sus avisos en orden.
  const conteos = await Promise.all(
    registros.map(async ({ key, reg }) => {
      const canal = canalDe(reg);
      if (canal !== 'push' && !reg.confirmado) {
        // Vinculaciones abandonadas (nunca tocaron Iniciar o el enlace del correo).
        if (Date.now() - new Date(reg.creado).getTime() > UN_DIA) await subsStore.delete(key);
        return 0;
      }
      if (canal === 'push' && !wp) return 0;
      let n = 0;
      for (const aviso of avisos) {
        if (aviso.umbral < umbralDe(reg)) continue;
        const { resultado: r } = await enviarPorCanal(key, reg, payloadDeSismo(aviso.sismo, aviso), wp);
        if (r === 'caducada') {
          await subsStore.delete(key);
          break;
        }
        if (r === 'ok') n++;
      }
      return n;
    }),
  );
  const enviados = conteos.reduce((a, b) => a + b, 0);
  console.log(`[${origen}] ${avisos.length} avisos, ${enviados} envíos a ${registros.length} suscriptores`);
  return { avisos: avisos.length, enviados };
}

// Latido del worker: la función programada lo lee para saber si debe actuar.
export const LATIDO_VIGENTE_MS = 90_000;
export async function latidoVigente() {
  const l = await tiendaEstado().get('latido-worker', { type: 'json' });
  return Boolean(l?.t && Date.now() - new Date(l.t).getTime() < LATIDO_VIGENTE_MS);
}
export const marcarLatido = () =>
  tiendaEstado().setJSON('latido-worker', { t: new Date().toISOString() });
