// Respaldo: cada minuto revisa el feed del SGC, pero SOLO si el worker de
// tiempo real no está vivo. Si el worker cae, esta función toma el relevo
// con demora de hasta 1 minuto; cuando el worker vuelve, se aparta sola.
import { sismosEnZona } from './lib/zona.mjs';
import { procesarSismos, latidoVigente } from './lib/procesar.mjs';

export default async () => {
  if (await latidoVigente()) return;
  const r = await procesarSismos(await sismosEnZona(), { origen: 'respaldo-netlify' });
  if (r.inicializado) console.log('Estado inicializado sin notificar');
};

export const config = { schedule: '* * * * *' };
