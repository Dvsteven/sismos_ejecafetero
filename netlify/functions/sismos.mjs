import { ZONA, REFERENCIA } from './lib/zona.mjs';
import { obtenerSismos } from './lib/fuentes.mjs';
import { json } from './lib/push.mjs';

// Lista para la interfaz. Responde 200 mientras al menos una fuente funcione.
export default async () => {
  try {
    const { sismos, fuentes } = await obtenerSismos();
    return new Response(
      JSON.stringify({ zona: ZONA, referencia: REFERENCIA, sismos, fuentes, consultado: new Date().toISOString() }),
      { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' } },
    );
  } catch (e) {
    console.error(e.message);
    return json({ zona: ZONA, referencia: REFERENCIA, sismos: [], error: e.message }, 503);
  }
};

export const config = { path: '/api/sismos' };
