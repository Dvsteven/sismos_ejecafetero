const $ = (id) => document.getElementById(id);
const CLAVE_UMBRAL = 'sismos:minMag';

// ---------- Utilidades ----------
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function haceCuanto(iso) {
  const seg = (new Date(iso).getTime() - Date.now()) / 1000;
  const pasos = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [Infinity, 'day']];
  const div = { second: 1, minute: 60, hour: 3600, day: 86400 };
  for (const [lim, unidad] of pasos) {
    if (Math.abs(seg) < lim) return rtf.format(Math.round(seg / div[unidad]), unidad);
  }
}
const nivel = (m) => (m >= 4 ? 'alto' : m >= 2.5 ? 'medio' : 'bajo');
const textoUmbral = (v) => (Number(v) === 0 ? 'cualquier magnitud' : `M${Number(v).toFixed(1)} o más`);

function base64UrlABytes(b64) {
  const relleno = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

// ---------- Sismograma ----------
function dibujarSismograma(sismos) {
  const svg = $('traza');
  const W = 1000, H = 160, centro = H / 2;
  const fin = Date.now(), inicio = fin - 5 * 86400e3;
  const x = (t) => ((t - inicio) / (fin - inicio)) * W;

  // Ruido de fondo determinista para que la línea "respire" sin eventos.
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280 - 0.5);

  const eventos = sismos
    .filter((s) => s.utc)
    .map((s) => ({ x: x(new Date(s.utc).getTime()), mag: s.mag }))
    .sort((a, b) => a.x - b.x);

  const puntos = [];
  let i = 0;
  for (let px = 0; px <= W; px += 2) {
    let y = centro + azar() * 3;
    while (i < eventos.length && eventos[i].x < px) i++;
    for (let k = Math.max(0, i - 3); k < Math.min(eventos.length, i + 1); k++) {
      const e = eventos[k];
      const d = px - e.x;
      if (d >= 0 && d < 40) {
        const amp = Math.min(centro - 6, Math.pow(1.9, e.mag + 1) * 2.2);
        y += Math.sin(d * 1.3) * amp * Math.exp(-d / 12);
      }
    }
    puntos.push(`${px},${y.toFixed(1)}`);
  }

  const guias = [1, 2, 3, 4]
    .map((d) => `<line class="guia" x1="${(W / 5) * d}" x2="${(W / 5) * d}" y1="0" y2="${H}"/>`)
    .join('');
  const fuertes = eventos
    .filter((e) => e.mag >= 4)
    .map((e) => `<line class="guia fuerte" x1="${e.x}" x2="${e.x}" y1="4" y2="${H - 4}"/>`)
    .join('');
  svg.innerHTML = `${guias}${fuertes}<polyline class="linea" points="${puntos.join(' ')}"/>`;
}

// ---------- Mapa y lista ----------
let mapa, capaSismos;
function iniciarMapa(zona, referencia) {
  if (!window.L) return;
  mapa = L.map('mapa', { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12,
    attribution: '&copy; OpenStreetMap',
  }).addTo(mapa);
  const poli = L.polygon(zona, { color: '#D7263D', weight: 3, fillOpacity: 0.04 }).addTo(mapa);
  L.circleMarker([referencia.lat, referencia.lon], { radius: 6, color: '#1A73E8', fillOpacity: 1 })
    .bindTooltip(referencia.nombre)
    .addTo(mapa);
  mapa.fitBounds(poli.getBounds(), { padding: [8, 8] });
  capaSismos = L.layerGroup().addTo(mapa);
}

function pintarSismos(sismos, destacado) {
  const lista = $('lista');
  if (!sismos.length) {
    lista.innerHTML = '<li class="vacio">Sin sismos registrados en la zona en los últimos 5 días.</li>';
  } else {
    lista.innerHTML = sismos
      .slice(0, 80)
      .map((s) => `
        <li id="s-${s.id}" class="${s.id === destacado ? 'resaltado' : ''}">
          <span class="mag" data-nivel="${nivel(s.mag)}">${s.mag.toFixed(1)}</span>
          <span>
            <span class="lugar">${s.lugar}</span>
            <span class="meta">${haceCuanto(s.utc)}, ${s.local?.slice(11, 16) ?? ''} hora local.
            ${s.profKm ?? '?'} km de profundidad, a ${s.distanciaKm} km de Pereira.
            ${s.revisado ? '' : 'Automático.'}</span>
          </span>
        </li>`)
      .join('');
  }

  if (capaSismos) {
    capaSismos.clearLayers();
    const colores = { bajo: '#5B7083', medio: '#E08E0B', alto: '#D7263D' };
    sismos.forEach((s) => {
      L.circleMarker([s.lat, s.lon], {
        radius: 3 + s.mag * 2,
        color: colores[nivel(s.mag)],
        weight: 1.5,
        fillOpacity: 0.35,
      })
        .bindPopup(`<strong>M${s.mag.toFixed(1)}</strong> ${s.lugar}<br>${haceCuanto(s.utc)}`)
        .addTo(capaSismos);
    });
  }

  if (destacado) $(`s-${destacado}`)?.scrollIntoView({ block: 'center' });
}

function pintarEncabezado(sismos, error) {
  if (error) {
    $('estado-titulo').textContent = 'El feed del SGC no responde';
    $('estado-detalle').textContent = 'Se reintenta en un minuto. Las alertas siguen activas en el servidor.';
    return;
  }
  if (!sismos.length) {
    $('estado-titulo').textContent = 'Zona tranquila';
    $('estado-detalle').textContent = 'Ningún sismo registrado en los últimos 5 días.';
    return;
  }
  const u = sismos[0];
  const mayor = sismos.reduce((a, b) => (b.mag > a.mag ? b : a));
  $('estado-titulo').textContent = `M${u.mag.toFixed(1)} en ${u.lugar.split(' - ')[0]}, ${haceCuanto(u.utc)}`;
  $('estado-detalle').textContent =
    `${sismos.length} sismos en la zona en 5 días. El mayor fue M${mayor.mag.toFixed(1)} en ${mayor.lugar}.`;
}

async function cargarSismos() {
  const destacado = new URLSearchParams(location.search).get('sismo');
  try {
    const data = await api('/api/sismos');
    if (!mapa) iniciarMapa(data.zona, data.referencia);
    pintarEncabezado(data.sismos);
    dibujarSismograma(data.sismos);
    pintarSismos(data.sismos, destacado);
  } catch (e) {
    pintarEncabezado([], e);
    dibujarSismograma([]);
  }
}

// ---------- Push ----------
const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let registro;

function ponerEstado(texto, activo = false) {
  const el = $('alertas-estado');
  el.textContent = texto;
  el.dataset.activo = activo ? 'si' : 'no';
  $('btn-activar').hidden = activo;
  $('btn-probar').hidden = !activo;
  $('btn-desactivar').hidden = !activo;
}

async function guardarSuscripcion(sub) {
  await api('/api/suscripcion', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON(), minMag: Number($('minMag').value) }),
  });
}

async function activar() {
  const btn = $('btn-activar');
  btn.disabled = true;
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      ponerEstado('Bloqueaste las notificaciones. Actívalas en los ajustes del navegador para este sitio.');
      return;
    }
    const { publicKey } = await api('/api/vapid');
    const sub =
      (await registro.pushManager.getSubscription()) ||
      (await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlABytes(publicKey),
      }));
    await guardarSuscripcion(sub);
    ponerEstado(`Activas: te avisamos desde ${textoUmbral($('minMag').value)}.`, true);
  } catch (e) {
    ponerEstado(`No se pudieron activar: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function desactivar() {
  const sub = await registro.pushManager.getSubscription();
  if (sub) {
    await api('/api/suscripcion', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  ponerEstado('Alertas desactivadas en este dispositivo.');
}

async function probar() {
  const btn = $('btn-probar');
  btn.disabled = true;
  try {
    const sub = await registro.pushManager.getSubscription();
    await api('/api/probar', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    btn.textContent = 'Prueba enviada';
  } catch (e) {
    btn.textContent = `Falló: ${e.message}`;
  } finally {
    setTimeout(() => { btn.textContent = 'Enviar prueba'; btn.disabled = false; }, 3000);
  }
}

let temporizadorUmbral;
function alCambiarUmbral() {
  const v = $('minMag').value;
  $('minMag-valor').textContent = textoUmbral(v);
  localStorage.setItem(CLAVE_UMBRAL, v);
  clearTimeout(temporizadorUmbral);
  temporizadorUmbral = setTimeout(async () => {
    const sub = await registro?.pushManager.getSubscription();
    if (!sub) return;
    await guardarSuscripcion(sub).catch(() => {});
    ponerEstado(`Activas: te avisamos desde ${textoUmbral(v)}.`, true);
  }, 600);
}

async function iniciarPush() {
  const guardado = localStorage.getItem(CLAVE_UMBRAL);
  if (guardado !== null) $('minMag').value = guardado;
  $('minMag-valor').textContent = textoUmbral($('minMag').value);
  $('minMag').addEventListener('input', alCambiarUmbral);

  if (!('serviceWorker' in navigator)) {
    ponerEstado('Este navegador no soporta alertas en segundo plano.');
    $('btn-activar').hidden = true;
    return;
  }
  registro = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  if (!('PushManager' in window)) {
    if (esIOS && !instalada) {
      $('ios-aviso').hidden = false;
      ponerEstado('Instala la app para poder recibir alertas.');
    } else {
      ponerEstado('Este navegador no soporta notificaciones push.');
    }
    $('btn-activar').hidden = true;
    return;
  }

  const sub = await registro.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    await guardarSuscripcion(sub).catch(() => {}); // re-sincroniza por si el servidor la perdió
    ponerEstado(`Activas: te avisamos desde ${textoUmbral($('minMag').value)}.`, true);
  } else {
    ponerEstado('Apagadas. Actívalas para recibir avisos aunque la app esté cerrada.');
  }

  $('btn-activar').addEventListener('click', activar);
  $('btn-desactivar').addEventListener('click', desactivar);
  $('btn-probar').addEventListener('click', probar);
}

// Instalación en Android / escritorio
let promptInstalar;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptInstalar = e;
  $('btn-instalar').hidden = false;
});
$('btn-instalar').addEventListener('click', async () => {
  promptInstalar?.prompt();
  await promptInstalar?.userChoice;
  $('btn-instalar').hidden = true;
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.tipo === 'nuevo-sismo') cargarSismos();
});

cargarSismos();
setInterval(cargarSismos, 60_000);
iniciarPush();
