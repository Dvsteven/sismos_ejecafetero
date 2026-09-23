// Fuentes de datos sísmicos, en orden de preferencia:
//   1. SGC   feed oficial de Colombia (todas las magnitudes, el más completo)
//   2. EMSC  Centro Sismológico Euro-Mediterráneo (recibe datos del SGC, rápido)
//   3. USGS  Servicio Geológico de EE. UU. (muy confiable, pero solo ~M2.5+)
//
// Por qué varias: el SGC responde 403 a algunos servidores en la nube (como
// los de Netlify). Si solo dependiéramos de él, un sismo como el M4.5 de
// Chaparral pasaría sin aviso. Se consultan las tres en paralelo, se unen y
// se eliminan duplicados (el mismo sismo reportado por varias agencias).
import { ZONA, FEED_SGC, dentroDeZona, distanciaKm, normalizar as normalizarSGC, REFERENCIA } from './zona.mjs';

const CINCO_DIAS = 5 * 86400e3;
const CABECERAS = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (compatible; AlertasSismosEjeCafetero/1.0)',
};

// Caja que contiene el polígono (con margen), para las consultas FDSN.
const lats = ZONA.map(([la]) => la);
const lons = ZONA.map(([, lo]) => lo);
const CAJA = {
  minlatitude: (Math.min(...lats) - 0.1).toFixed(2),
  maxlatitude: (Math.max(...lats) + 0.1).toFixed(2),
  minlongitude: (Math.min(...lons) - 0.1).toFixed(2),
  maxlongitude: (Math.max(...lons) + 0.1).toFixed(2),
};

// Municipios de referencia para nombrar sismos de fuentes que no traen un
// lugar en español (EMSC dice solo "COLOMBIA", USGS lo da en inglés).
const MUNICIPIOS = [
  ['Pereira', 'Risaralda', 4.8133, -75.6961], ['Dosquebradas', 'Risaralda', 4.8392, -75.6673],
  ['Santa Rosa de Cabal', 'Risaralda', 4.8686, -75.6214], ['Pueblo Rico', 'Risaralda', 5.2217, -76.0317],
  ['Apía', 'Risaralda', 5.1064, -75.9425], ['Belén de Umbría', 'Risaralda', 5.2003, -75.8683],
  ['Mistrató', 'Risaralda', 5.2964, -75.8836], ['Manizales', 'Caldas', 5.0703, -75.5138],
  ['Chinchiná', 'Caldas', 4.9825, -75.6036], ['Anserma', 'Caldas', 5.2386, -75.7842],
  ['Riosucio', 'Caldas', 5.4217, -75.7031], ['Salamina', 'Caldas', 5.4031, -75.4869],
  ['Aguadas', 'Caldas', 5.6092, -75.4564], ['La Dorada', 'Caldas', 5.4538, -74.6634],
  ['Armenia', 'Quindío', 4.5339, -75.6811], ['Calarcá', 'Quindío', 4.5297, -75.6436],
  ['Ibagué', 'Tolima', 4.4389, -75.2322], ['Chaparral', 'Tolima', 3.7236, -75.4847],
  ['Rioblanco', 'Tolima', 3.53, -75.645], ['Ortega', 'Tolima', 3.9364, -75.2217],
  ['Coyaima', 'Tolima', 3.7978, -75.1947], ['Rovira', 'Tolima', 4.2394, -75.2403],
  ['Cajamarca', 'Tolima', 4.4406, -75.4267], ['Líbano', 'Tolima', 4.9217, -75.0622],
  ['Fresno', 'Tolima', 5.1528, -75.0361], ['Mariquita', 'Tolima', 5.1989, -74.8931],
  ['Honda', 'Tolima', 5.2044, -74.7359], ['Espinal', 'Tolima', 4.1492, -74.8843],
  ['Girardot', 'Cundinamarca', 4.3031, -74.8044], ['Melgar', 'Tolima', 4.2047, -74.6406],
  ['Cartago', 'Valle del Cauca', 4.7464, -75.9117], ['Tuluá', 'Valle del Cauca', 4.0847, -76.1954],
  ['Buga', 'Valle del Cauca', 3.9009, -76.2978], ['Roldanillo', 'Valle del Cauca', 4.4133, -76.1547],
  ['Zarzal', 'Valle del Cauca', 4.3947, -76.0717], ['Sevilla', 'Valle del Cauca', 4.2667, -75.9333],
  ['Caicedonia', 'Valle del Cauca', 4.3322, -75.8272], ['San José del Palmar', 'Chocó', 4.8964, -76.2342],
  ['Istmina', 'Chocó', 5.1606, -76.6844], ['Tadó', 'Chocó', 5.2656, -76.5644],
  ['Condoto', 'Chocó', 5.0933, -76.65], ['Nóvita', 'Chocó', 4.9561, -76.6089],
];

export function lugarCercano(lat, lon) {
  let mejor = null;
  for (const [nombre, depto, la, lo] of MUNICIPIOS) {
    const d = distanciaKm(lat, lon, la, lo);
    if (!mejor || d < mejor.d) mejor = { nombre, depto, d };
  }
  return mejor.d < 15
    ? `${mejor.nombre} - ${mejor.depto}`
    : `${Math.round(mejor.d)} km de ${mejor.nombre} - ${mejor.depto}`;
}

// Hora local de Colombia (UTC-5, sin horario de verano).
const aLocal = (iso) => new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

function base({ id, fuente, mag, lat, lon, prof, utc, revisado, tipoMag }) {
  return {
    id, fuente, mag: Number(mag), tipoMag: tipoMag ?? null, lat, lon,
    profKm: Number.isFinite(prof) ? Math.round(Math.abs(prof)) : null,
    lugar: lugarCercano(lat, lon),
    utc, local: utc ? aLocal(utc) : null, revisado: Boolean(revisado),
    distanciaKm: Math.round(distanciaKm(lat, lon, REFERENCIA.lat, REFERENCIA.lon)),
  };
}

async function pedir(url, ms = 15_000) {
  const r = await fetch(url, { headers: CABECERAS, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`respondió ${r.status}`);
  return r.json();
}

const FUENTES = {
  async sgc() {
    const feed = await pedir(process.env.FEED_URL || FEED_SGC);
    if (!Array.isArray(feed?.features)) throw new Error('formato inesperado');
    return feed.features.map((f) => ({ ...normalizarSGC(f), fuente: 'SGC' }));
  },

  async emsc() {
    const q = new URLSearchParams({
      format: 'json', ...CAJA, starttime: new Date(Date.now() - CINCO_DIAS).toISOString().slice(0, 19),
      orderby: 'time', limit: '500',
    });
    const data = await pedir(`https://www.seismicportal.eu/fdsnws/event/1/query?${q}`);
    return (data.features ?? []).map((f) => {
      const p = f.properties ?? {};
      const [lon, lat, prof] = f.geometry?.coordinates ?? [p.lon, p.lat, p.depth];
      return base({
        id: `EMSC-${p.unid ?? f.id}`, fuente: 'EMSC', mag: p.mag, lat: p.lat ?? lat, lon: p.lon ?? lon,
        prof: p.depth ?? prof, utc: new Date(p.time).toISOString(), revisado: false, tipoMag: p.magtype,
      });
    });
  },

  async usgs() {
    const q = new URLSearchParams({
      format: 'geojson', ...CAJA, starttime: new Date(Date.now() - CINCO_DIAS).toISOString().slice(0, 19),
      orderby: 'time',
    });
    const data = await pedir(`https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`);
    return (data.features ?? []).map((f) => {
      const [lon, lat, prof] = f.geometry.coordinates;
      return base({
        id: `USGS-${f.id}`, fuente: 'USGS', mag: f.properties.mag, lat, lon, prof,
        utc: new Date(f.properties.time).toISOString(), revisado: f.properties.status === 'reviewed',
        tipoMag: f.properties.magType,
      });
    });
  },
};

/** ¿Son el mismo sismo reportado por dos agencias? */
export const mismoSismo = (a, b) =>
  Math.abs(new Date(a.utc) - new Date(b.utc)) < 120_000 && distanciaKm(a.lat, a.lon, b.lat, b.lon) < 100;

/**
 * Consulta todas las fuentes y devuelve los sismos de la zona sin duplicados.
 * Nunca lanza error mientras al menos una fuente responda.
 */
export async function obtenerSismos() {
  const nombres = Object.keys(FUENTES);
  const resultados = await Promise.allSettled(nombres.map((n) => FUENTES[n]()));

  const estadoFuentes = {};
  const unidos = [];
  resultados.forEach((r, i) => {
    const n = nombres[i];
    if (r.status === 'rejected') {
      estadoFuentes[n] = `error: ${r.reason?.message ?? r.reason}`;
      return;
    }
    const validos = r.value.filter(
      (s) => s.id && s.utc && Number.isFinite(s.mag) && Number.isFinite(s.lat) && dentroDeZona(s.lat, s.lon),
    );
    let nuevos = 0;
    for (const s of validos) {
      // Las fuentes van en orden de preferencia: si ya hay un reporte del
      // mismo sismo por una fuente mejor, se descarta este.
      if (!unidos.some((u) => mismoSismo(u, s))) {
        unidos.push(s);
        nuevos++;
      }
    }
    estadoFuentes[n] = `ok (${validos.length} en zona, ${nuevos} aportados)`;
  });

  if (resultados.every((r) => r.status === 'rejected')) {
    throw new Error(`Ninguna fuente respondió: ${JSON.stringify(estadoFuentes)}`);
  }
  unidos.sort((a, b) => b.utc.localeCompare(a.utc));
  return { sismos: unidos, fuentes: estadoFuentes };
}
