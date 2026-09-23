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

// ---------- Avisos: varios medios ----------
const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const CLAVE_CANALES = 'sismos:canales';
let registro;          // service worker
let disponibles = {};  // qué ofrece el servidor
let pushActivo = false;
let estados = {};      // clave -> estado del servidor
let sondeo;

const leerCanales = () => {
  try { return JSON.parse(localStorage.getItem(CLAVE_CANALES)) || []; } catch { return []; }
};
const guardarCanales = (l) => localStorage.setItem(CLAVE_CANALES, JSON.stringify(l));
const umbralActual = () => Number($('minMag').value);
const escapar = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const NOMBRES = { push: 'Este teléfono', telegram: 'Telegram', correo: 'Correo', ntfy: 'ntfy' };

// ----- Push del navegador -----
const mismasBytes = (a, b) => a && b && a.byteLength === b.byteLength &&
  new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);

async function suscripcionVigente() {
  const { publicKey } = await api('/api/vapid');
  const llave = base64UrlABytes(publicKey);
  let sub = await registro.pushManager.getSubscription();
  if (sub && !mismasBytes(sub.options?.applicationServerKey, llave.buffer)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub || registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llave });
}

async function guardarSuscripcion(sub) {
  await api('/api/suscripcion', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON(), minMag: umbralActual() }),
  });
}

function explicarErrorSuscripcion(e) {
  const m = `${e.name}: ${e.message}`;
  if (/push service error|AbortError/i.test(m)) {
    return 'Este teléfono no pudo conectarse al servicio de notificaciones de Google. ' +
      'Suele pasar con DNS privado que bloquea dominios de Google, con Brave (activa "Usar servicios de Google ' +
      'para mensajería push" en Privacidad) o en teléfonos sin Google Play. Prueba Telegram o ntfy.';
  }
  if (/applicationServerKey|InvalidAccessError/i.test(m)) return 'El servidor tiene mal configurada la llave de notificaciones.';
  return e.message;
}

function pushSoportado() {
  if (!('serviceWorker' in navigator)) return 'Este navegador no soporta notificaciones.';
  if (!('PushManager' in window)) {
    return esIOS && !instalada
      ? 'En iPhone primero instala la app: Compartir → Agregar a pantalla de inicio.'
      : 'Este navegador no soporta notificaciones.';
  }
  return null;
}

async function activarPush() {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error('Bloqueaste las notificaciones. Actívalas en los ajustes del navegador para este sitio.');
  }
  try {
    await guardarSuscripcion(await suscripcionVigente());
  } catch (e) {
    throw new Error(explicarErrorSuscripcion(e));
  }
  pushActivo = true;
}

async function quitarPush() {
  const sub = await registro?.pushManager.getSubscription();
  if (sub) {
    await api('/api/suscripcion', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  pushActivo = false;
}

// ----- Lista "Tus avisos" -----
function textoEstado(c) {
  const e = estados[c.clave];
  if (!e) return 'Revisando…';
  if (!e.confirmado) {
    return c.canal === 'correo' ? 'Falta confirmar: revisa tu correo y el spam.' : 'Falta tocar Iniciar en Telegram.';
  }
  if (c.canal === 'correo') return `Activo, desde M${Math.max(disponibles.correo?.minMag ?? 3, e.minMag).toFixed(1)}.`;
  if (c.canal === 'ntfy') return `Activo en el tema ${e.destino}.`;
  return 'Activo.';
}

function pintarAvisos() {
  const canales = leerCanales();
  const filas = [];
  if (pushActivo) {
    filas.push(`<li><span><strong>Este teléfono</strong><span class="meta">Notificaciones activas.</span></span>
      <span class="fila-acciones"><button class="btn btn--chico" data-probar="push">Probar</button>
      <button class="btn btn--quieto" data-quitar="push">Quitar</button></span></li>`);
  }
  for (const c of canales) {
    filas.push(`<li><span><strong>${escapar(estados[c.clave]?.etiqueta || c.etiqueta || NOMBRES[c.canal])}</strong>
      <span class="meta">${escapar(textoEstado(c))}</span></span>
      <span class="fila-acciones">${estados[c.clave]?.confirmado ? `<button class="btn btn--chico" data-probar="${c.clave}">Probar</button>` : ''}
      <button class="btn btn--quieto" data-quitar="${c.clave}">Quitar</button></span></li>`);
  }
  $('mis-canales').innerHTML = filas.join('');

  const activos = (pushActivo ? 1 : 0) + canales.filter((c) => estados[c.clave]?.confirmado).length;
  const el = $('alertas-estado');
  el.dataset.activo = activos ? 'si' : 'no';
  el.textContent = activos
    ? `Recibes avisos desde ${textoUmbral(umbralActual())}.`
    : filas.length ? 'Termina de activar el medio que elegiste.' : 'Todavía no recibes avisos. Elige por dónde quieres que te lleguen.';
  $('btn-agregar').textContent = filas.length ? 'Agregar otro medio' : 'Activar avisos';
}

async function refrescarEstados() {
  const canales = leerCanales();
  if (!canales.length) return pintarAvisos();
  try {
    const { estados: lista } = await api('/api/canales/estado', {
      method: 'POST',
      body: JSON.stringify({ items: canales.map(({ clave, token }) => ({ clave, token })) }),
    });
    estados = Object.fromEntries(lista.map((e) => [e.clave, e]));
    // Si se dio de baja desde Telegram o el correo, se quita de aquí también.
    guardarCanales(canales.filter((c) => estados[c.clave]?.existe !== false));
  } catch { /* sin conexión: se muestra lo guardado */ }
  pintarAvisos();
}

// ----- Selector de medio -----
function abrirSelector() {
  const opciones = [];
  const motivoPush = pushSoportado();
  if (disponibles.push && !pushActivo) {
    opciones.push(['push', 'Notificación en este teléfono', motivoPush || 'Llega como cualquier notificación, aunque la app esté cerrada.', Boolean(motivoPush)]);
  }
  if (disponibles.telegram?.bot) {
    opciones.push(['telegram', 'Telegram', 'Un mensaje de nuestro bot. Funciona en cualquier teléfono con Telegram.']);
  }
  if (disponibles.correo) {
    opciones.push(['correo', 'Correo electrónico', `Solo sismos de M${disponibles.correo.minMag.toFixed(1)} o más, para no llenar tu bandeja.`]);
  }
  if (disponibles.ntfy) {
    opciones.push(['ntfy', 'App ntfy', 'App gratuita de avisos, sin cuenta. Buena opción si las notificaciones del navegador no te llegan.']);
  }
  $('opciones').innerHTML = opciones.map(([id, nombre, desc, deshabilitado]) => `
    <button class="opcion" type="button" data-canal="${id}" ${deshabilitado ? 'disabled' : ''}>
      <strong>${nombre}</strong><span>${escapar(desc)}</span>
    </button>`).join('') || '<p class="meta">No hay medios configurados en el servidor.</p>';
  $('paso').innerHTML = '';
  $('opciones').hidden = false;
  $('selector').hidden = false;
  $('btn-agregar').hidden = true;
  $('selector').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function cerrarSelector() {
  clearInterval(sondeo);
  $('selector').hidden = true;
  $('btn-agregar').hidden = false;
}

function mostrarPaso(html) {
  $('opciones').hidden = true;
  $('paso').innerHTML = html;
}

function agregarLocal(c) {
  guardarCanales([...leerCanales().filter((x) => x.clave !== c.clave), c]);
}

const flujos = {
  async push() {
    mostrarPaso('<p>Acepta el permiso de notificaciones que te pide el teléfono.</p>');
    try {
      await activarPush();
      mostrarPaso('<p class="exito">Listo, este teléfono recibirá los avisos.</p>');
      pintarAvisos();
      setTimeout(cerrarSelector, 1500);
    } catch (e) {
      mostrarPaso(`<p class="error">${escapar(e.message)}</p><button class="btn" type="button" data-volver>Elegir otro medio</button>`);
    }
  },

  async telegram() {
    const r = await api('/api/canales/telegram', { method: 'POST', body: JSON.stringify({ minMag: umbralActual() }) });
    agregarLocal({ clave: r.clave, token: r.token, canal: 'telegram', etiqueta: 'Telegram' });
    mostrarPaso(`
      <p>Abre Telegram y toca <strong>Iniciar</strong> en el chat del bot @${escapar(r.bot)}.</p>
      <a class="btn btn--principal" href="${r.enlace}" target="_blank" rel="noopener">Abrir Telegram</a>
      <p class="meta" id="tg-espera">Esperando que toques Iniciar…</p>`);
    let intentos = 0;
    clearInterval(sondeo);
    sondeo = setInterval(async () => {
      if (++intentos > 90) { clearInterval(sondeo); $('tg-espera').textContent = 'No detectamos la vinculación. Puedes intentarlo de nuevo cuando quieras.'; return; }
      await refrescarEstados();
      if (estados[r.clave]?.confirmado) {
        clearInterval(sondeo);
        mostrarPaso('<p class="exito">Listo, Telegram quedó vinculado.</p>');
        setTimeout(cerrarSelector, 1500);
      }
    }, 2000);
  },

  async correo() {
    mostrarPaso(`
      <label class="campo" for="email">Tu correo</label>
      <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="nombre@correo.com">
      <button class="btn btn--principal" type="button" id="btn-enviar-correo">Enviar confirmación</button>
      <p class="error" id="correo-error" hidden></p>`);
    $('email').focus();
    $('btn-enviar-correo').addEventListener('click', async () => {
      const btn = $('btn-enviar-correo');
      btn.disabled = true;
      try {
        const email = $('email').value.trim();
        const r = await api('/api/canales/correo', { method: 'POST', body: JSON.stringify({ email, minMag: umbralActual() }) });
        agregarLocal({ clave: r.clave, token: r.token, canal: 'correo', etiqueta: email });
        mostrarPaso(`<p class="exito">Te enviamos un correo a ${escapar(email)}.</p>
          <p>Toca <strong>Confirmar mi correo</strong> en ese mensaje. Si no aparece en unos minutos, revisa spam o promociones.</p>`);
        refrescarEstados();
        setTimeout(cerrarSelector, 5000);
      } catch (e) {
        $('correo-error').textContent = e.message;
        $('correo-error').hidden = false;
        btn.disabled = false;
      }
    });
  },

  async ntfy() {
    const r = await api('/api/canales/ntfy', { method: 'POST', body: JSON.stringify({ minMag: umbralActual() }) });
    agregarLocal({ clave: r.clave, token: r.token, canal: 'ntfy', etiqueta: 'ntfy' });
    mostrarPaso(`
      <ol class="pasos">
        <li>Instala ntfy:
          <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> o
          <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>.</li>
        <li>En la app toca <strong>+</strong> y suscríbete a este tema:
          <span class="tema"><code id="tema">${escapar(r.topic)}</code>
          <button class="btn btn--chico" type="button" id="btn-copiar">Copiar</button></span></li>
      </ol>
      <p class="meta">El nombre del tema es tu llave: no lo compartas en público.</p>
      <button class="btn" type="button" data-cerrar>Ya me suscribí</button>`);
    $('btn-copiar').addEventListener('click', async () => {
      await navigator.clipboard?.writeText(r.topic).catch(() => {});
      $('btn-copiar').textContent = 'Copiado';
    });
    refrescarEstados();
  },
};

async function elegir(canal) {
  try {
    await flujos[canal]();
  } catch (e) {
    mostrarPaso(`<p class="error">${escapar(e.message)}</p><button class="btn" type="button" data-volver>Elegir otro medio</button>`);
  }
}

async function probar(id, btn) {
  btn.disabled = true;
  try {
    if (id === 'push') {
      const sub = await registro.pushManager.getSubscription();
      await api('/api/probar', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    } else {
      const c = leerCanales().find((x) => x.clave === id);
      await api('/api/probar', { method: 'POST', body: JSON.stringify({ clave: c.clave, token: c.token }) });
    }
    btn.textContent = 'Enviada';
  } catch (e) {
    btn.textContent = 'Falló';
    $('alertas-estado').textContent = e.message;
  } finally {
    setTimeout(() => { btn.textContent = 'Probar'; btn.disabled = false; }, 3000);
  }
}

async function quitar(id) {
  if (id === 'push') {
    await quitarPush();
  } else {
    const c = leerCanales().find((x) => x.clave === id);
    if (c) await api('/api/canales/quitar', { method: 'POST', body: JSON.stringify({ clave: c.clave, token: c.token }) }).catch(() => {});
    guardarCanales(leerCanales().filter((x) => x.clave !== id));
    delete estados[id];
  }
  pintarAvisos();
}

let temporizadorUmbral;
function alCambiarUmbral() {
  const v = $('minMag').value;
  $('minMag-valor').textContent = textoUmbral(v);
  localStorage.setItem(CLAVE_UMBRAL, v);
  clearTimeout(temporizadorUmbral);
  temporizadorUmbral = setTimeout(async () => {
    const tareas = [];
    const sub = await registro?.pushManager?.getSubscription();
    if (sub) tareas.push(guardarSuscripcion(sub));
    const canales = leerCanales();
    if (canales.length) {
      tareas.push(api('/api/canales/umbral', {
        method: 'POST',
        body: JSON.stringify({ items: canales.map(({ clave, token }) => ({ clave, token })), minMag: Number(v) }),
      }));
    }
    await Promise.allSettled(tareas);
    refrescarEstados();
  }, 600);
}

async function iniciarAvisos() {
  const guardado = localStorage.getItem(CLAVE_UMBRAL);
  if (guardado !== null) $('minMag').value = guardado;
  $('minMag-valor').textContent = textoUmbral($('minMag').value);
  $('minMag').addEventListener('input', alCambiarUmbral);

  $('btn-agregar').addEventListener('click', abrirSelector);
  $('btn-cancelar').addEventListener('click', cerrarSelector);
  $('opciones').addEventListener('click', (e) => {
    const b = e.target.closest('[data-canal]');
    if (b && !b.disabled) elegir(b.dataset.canal);
  });
  $('paso').addEventListener('click', (e) => {
    if (e.target.closest('[data-volver]')) abrirSelector();
    if (e.target.closest('[data-cerrar]')) cerrarSelector();
  });
  $('mis-canales').addEventListener('click', (e) => {
    const p = e.target.closest('[data-probar]');
    const q = e.target.closest('[data-quitar]');
    if (p) probar(p.dataset.probar, p);
    if (q) quitar(q.dataset.quitar);
  });

  if (esIOS && !instalada) $('ios-aviso').hidden = false;

  disponibles = await api('/api/canales').catch(() => ({ push: true }));

  if ('serviceWorker' in navigator) {
    registro = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if ('PushManager' in window) {
      const sub = await registro.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        pushActivo = true;
        // Re-sincroniza por si el servidor la perdió o cambiaron las llaves.
        suscripcionVigente().then(guardarSuscripcion).catch(() => {});
      }
    }
  }

  pintarAvisos();
  refrescarEstados();
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
iniciarAvisos();
