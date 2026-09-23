// Función programada: cada minuto consulta el feed del SGC, detecta sismos
// nuevos dentro de la zona y envía push a cada dispositivo suscrito cuyo
// umbral de magnitud se cumpla.
import { sismosEnZona } from './lib/zona.mjs';
import {
  configurarVapid, enviar, payloadDeSismo, tiendaEstado, tiendaSuscripciones,
} from './lib/push.mjs';

const SEIS_DIAS = 6 * 24 * 3600 * 1000;
const CORRECCION_MINIMA = 0.5; // re-avisar si el SGC corrige la magnitud en ±0.5 o más

export default async () => {
  const estadoStore = tiendaEstado();
  const estado = (await estadoStore.get('vistos', { type: 'json' })) ?? null;
  const sismos = await sismosEnZona();

  // Primera ejecución: memoriza lo que ya está en el feed sin notificar,
  // para no disparar 5 días de sismos de golpe.
  if (!estado) {
    const vistos = Object.fromEntries(sismos.map((s) => [s.id, { mag: s.mag, utc: s.utc }]));
    await estadoStore.setJSON('vistos', vistos);
    console.log(`Inicializado con ${sismos.length} sismos en zona`);
    return;
  }

  const avisos = [];
  for (const s of sismos) {
    const previo = estado[s.id];
    if (!previo) {
      avisos.push({ sismo: s, umbral: s.mag, corregido: false });
    } else if (Math.abs(s.mag - previo.mag) >= CORRECCION_MINIMA) {
      avisos.push({ sismo: s, umbral: Math.max(s.mag, previo.mag), corregido: true });
    }
    estado[s.id] = { mag: s.mag, utc: s.utc };
  }

  // Limpia eventos que ya salieron de la ventana del feed.
  const limite = Date.now() - SEIS_DIAS;
  for (const [id, v] of Object.entries(estado)) {
    if (v.utc && new Date(v.utc).getTime() < limite) delete estado[id];
  }
  await estadoStore.setJSON('vistos', estado);

  if (!avisos.length) return;

  // Del más antiguo al más reciente, para que el último en llegar sea el último ocurrido.
  avisos.reverse();

  const wp = configurarVapid();
  const subsStore = tiendaSuscripciones();
  const { blobs } = await subsStore.list();
  const registros = await Promise.all(
    blobs.map(async ({ key }) => ({ key, reg: await subsStore.get(key, { type: 'json' }) })),
  );

  let enviados = 0;
  for (const { key, reg } of registros) {
    if (!reg) continue;
    for (const aviso of avisos) {
      if (aviso.umbral < (reg.minMag ?? 0)) continue;
      const r = await enviar(wp, reg.subscription, payloadDeSismo(aviso.sismo, aviso));
      if (r === 'caducada') {
        await subsStore.delete(key);
        break;
      }
      if (r === 'ok') enviados++;
    }
  }
  console.log(`${avisos.length} avisos, ${enviados} notificaciones enviadas a ${registros.length} dispositivos`);
};

export const config = { schedule: '* * * * *' };
