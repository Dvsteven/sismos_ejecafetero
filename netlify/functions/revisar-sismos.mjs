// Revisión cada minuto (respaldo del worker de tiempo real, si lo usas).
// Consulta SGC, EMSC y USGS; si el worker está vivo, no hace nada.
import { obtenerSismos } from './lib/fuentes.mjs';
import { procesarSismos, latidoVigente } from './lib/procesar.mjs';

export default async () => {
  try {
    if (await latidoVigente()) return;
    const { sismos, fuentes } = await obtenerSismos();
    const r = await procesarSismos(sismos, { origen: 'netlify' });
    if (r.inicializado) console.log('Estado inicializado sin notificar');
    if (Object.values(fuentes).some((f) => f.startsWith('error'))) console.log('Fuentes:', fuentes);
  } catch (e) {
    // Se registra sin relanzar: un fallo de red no debe marcar la función
    // como caída; en un minuto se vuelve a intentar.
    console.error('Revisión fallida:', e.message);
  }
};

export const config = { schedule: '* * * * *' };
