// Zona vigilada: el octágono rojo dibujado sobre el mapa (Eje Cafetero,
// norte del Valle, Tolima y borde oriental del Chocó).
// Vértices [lat, lon] calibrados contra ciudades de referencia del mapa.
// Para ajustarla, edita solo este arreglo: el frontend la recibe de /api/sismos.
export const ZONA = [
  [5.877, -76.145], // arriba izq. (occidente de Jericó)
  [5.871, -75.162], // arriba der.
  [5.334, -74.532], // La Dorada
  [4.292, -74.525], // oriente de Girardot / Melgar
  [3.450, -75.155], // sur, bajado para cubrir bien Chaparral, Ataco y Rioblanco
  [3.550, -76.089], // sur de Buga
  [4.357, -76.745], // occidente de Roldanillo
  [5.275, -76.755], // Istmina / Condoto
];

// Punto de referencia para la distancia que aparece en la notificación.
export const REFERENCIA = { nombre: 'Pereira', lat: 4.8133, lon: -75.6961 };

// Feed oficial del SGC: todas las magnitudes, ventana rodante de 5 días.
export const FEED_SGC =
  'https://archive.sgc.gov.co/feed/v1.0.1/summary/five_days_all.json';

/** Ray casting sobre vértices [lat, lon]. */
export function dentroDeZona(lat, lon, poligono = ZONA) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [yi, xi] = poligono[i];
    const [yj, xj] = poligono[j];
    const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = (g) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/**
 * OJO: el feed del SGC NO sigue el orden GeoJSON estándar:
 * geometry.coordinates viene como [lat, lon, profundidad].
 * Detectamos el orden por rango (en Colombia la lat está entre -5 y 14 y la
 * lon entre -82 y -66) por si algún día lo corrigen.
 */
function leerCoordenadas([a, b, prof]) {
  const pareceLat = (v) => v > -6 && v < 15;
  const pareceLon = (v) => v < -60 && v > -85;
  if (pareceLon(a) && pareceLat(b)) return { lat: b, lon: a, prof };
  return { lat: a, lon: b, prof };
}

function aFechaUtc(texto) {
  if (!texto) return null;
  const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(texto) ? texto : texto.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizar(f) {
  const p = f.properties ?? {};
  const { lat, lon, prof } = leerCoordenadas(f.geometry?.coordinates ?? []);
  return {
    id: f.id,
    mag: Number(p.mag),
    tipoMag: p.magType ?? null,
    lat,
    lon,
    profKm: Number.isFinite(prof) ? Math.round(prof) : null,
    lugar: (p.place ?? 'Ubicación sin nombre').replace(/,\s*Colombia\s*$/, ''),
    utc: aFechaUtc(p.utcTime),
    local: p.localTime ?? null,
    revisado: p.status === 'manual', // 'manual' = revisado por un sismólogo
    actualizado: p.updated ?? null,
    distanciaKm: Math.round(distanciaKm(lat, lon, REFERENCIA.lat, REFERENCIA.lon)),
  };
}

/** Filtra un feed ya descargado: solo sismos dentro de la zona, recientes primero. */
export function filtrarFeed(feed) {
  if (!Array.isArray(feed?.features)) throw new Error('El feed del SGC no trae "features"');
  return feed.features
    .map(normalizar)
    .filter((s) => s.id && Number.isFinite(s.mag) && Number.isFinite(s.lat) && dentroDeZona(s.lat, s.lon))
    .sort((a, b) => (b.utc ?? '').localeCompare(a.utc ?? ''));
}

/**
 * Descarga el feed con petición condicional. Si el servidor responde 304
 * (nada cambió desde la última vez) devuelve { cambio: false } sin bajar el
 * archivo completo: así consultar cada pocos segundos no castiga al SGC.
 */
export async function descargarFeed(cache = {}, url = process.env.FEED_URL || FEED_SGC) {
  const headers = { accept: 'application/json' };
  if (cache.etag) headers['if-none-match'] = cache.etag;
  if (cache.lastModified) headers['if-modified-since'] = cache.lastModified;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (r.status === 304) return { cambio: false, cache };
  if (!r.ok) throw new Error(`El feed del SGC respondió ${r.status}`);
  const feed = await r.json();
  return {
    cambio: true,
    feed,
    cache: { etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified') },
  };
}

/** Descarga el feed completo y devuelve solo los sismos dentro de la zona. */
export async function sismosEnZona() {
  const { feed } = await descargarFeed();
  return filtrarFeed(feed);
}
