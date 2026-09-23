// Worker de tiempo real: proceso siempre encendido que consulta el feed del
// SGC cada POLL_SECONDS (12 por defecto) y envía los push al instante.
// Comparte suscripciones y estado con Netlify a través de Netlify Blobs.
//
// Variables requeridas: NETLIFY_SITE_ID, NETLIFY_API_TOKEN,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import { descargarFeed, filtrarFeed } from '../netlify/functions/lib/zona.mjs';
import { procesarSismos, marcarLatido } from '../netlify/functions/lib/procesar.mjs';

const REQUERIDAS = ['NETLIFY_SITE_ID', 'NETLIFY_API_TOKEN', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
const faltan = REQUERIDAS.filter((k) => !process.env[k]);
if (faltan.length) {
  console.error(`Faltan variables de entorno: ${faltan.join(', ')}`);
  process.exit(1);
}

const INTERVALO_MS = Math.max(5, Number(process.env.POLL_SECONDS) || 12) * 1000;
const LATIDO_MS = 30_000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

let cache = {};
let fallosSeguidos = 0;
let ultimoLatido = 0;
let detener = false;

async function ciclo() {
  const inicio = Date.now();
  try {
    const r = await descargarFeed(cache);
    cache = r.cache;
    if (r.cambio) {
      const res = await procesarSismos(filtrarFeed(r.feed), { origen: 'worker' });
      if (res.inicializado) log('Estado inicializado sin notificar');
      else if (res.avisos) log(`${res.avisos} avisos, ${res.enviados} push enviados en ${Date.now() - inicio} ms`);
    }
    if (Date.now() - ultimoLatido > LATIDO_MS) {
      await marcarLatido();
      ultimoLatido = Date.now();
    }
    fallosSeguidos = 0;
  } catch (e) {
    fallosSeguidos++;
    log(`Error (${fallosSeguidos} seguidos): ${e.message}`);
  }
}

async function bucle() {
  log(`Worker iniciado, consultando cada ${INTERVALO_MS / 1000} s`);
  while (!detener) {
    const inicio = Date.now();
    await ciclo();
    // Si el SGC falla repetidamente, espacia los intentos hasta 2 minutos.
    const espera = fallosSeguidos
      ? Math.min(120_000, INTERVALO_MS * 2 ** Math.min(fallosSeguidos, 4))
      : Math.max(0, INTERVALO_MS - (Date.now() - inicio));
    await new Promise((res) => setTimeout(res, espera));
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`${sig} recibido, cerrando`);
    detener = true;
    setTimeout(() => process.exit(0), 1000);
  });
}

bucle();
