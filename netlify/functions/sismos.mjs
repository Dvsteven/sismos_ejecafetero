import { sismosEnZona, ZONA, REFERENCIA } from './lib/zona.mjs';
import { json } from './lib/push.mjs';

// Lista para la interfaz. El navegador no consulta al SGC directamente
// (evita problemas de CORS y deja un solo lugar donde vive la lógica de zona).
export default async () => {
  try {
    const sismos = await sismosEnZona();
    return new Response(
      JSON.stringify({ zona: ZONA, referencia: REFERENCIA, sismos, consultado: new Date().toISOString() }),
      { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } },
    );
  } catch (e) {
    return json({ zona: ZONA, referencia: REFERENCIA, sismos: [], error: e.message }, 502);
  }
};

export const config = { path: '/api/sismos' };
