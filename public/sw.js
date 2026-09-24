const CACHE = 'sismos-2026-09-24.1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png', '/Sounds/Google_Earthquake_Alert_Sound.mp3'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero para la app (siempre la versión fresca), caché si no hay señal.
// La API nunca se cachea: un dato sísmico viejo es peor que ninguno.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Sismo en tu zona', body: e.data?.text() }; }
  const fuerte = d.mag >= 4;
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || 'Sismo en tu zona', {
        body: d.body,
        tag: d.tag,
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: fuerte ? [400, 150, 400, 150, 800] : [200, 100, 200],
        requireInteraction: fuerte,
        data: { url: d.url || '/' },
      }),
      self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'nuevo-sismo' }))),
      reproducirAlerta(),
    ]),
  );
});

async function reproducirAlerta() {
  try {
    const cache = await caches.open(CACHE);
    const respuesta = await cache.match('/Sounds/Google_Earthquake_Alert_Sound.mp3');
    const blob = respuesta ? await respuesta.blob() : null;
    const url = blob ? URL.createObjectURL(blob) : '/Sounds/Google_Earthquake_Alert_Sound.mp3';
    const audio = new Audio(url);
    audio.volume = 1;
    await audio.play();
  } catch (err) {
    console.error('No se pudo reproducir la alerta de audio:', err);
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const abierta = cs.find((c) => new URL(c.url).origin === location.origin);
      if (abierta) return abierta.navigate(destino).then((c) => c?.focus());
      return self.clients.openWindow(destino);
    }),
  );
});
