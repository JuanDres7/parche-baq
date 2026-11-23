const cacheName = 'parche-__CACHE_VERSION__';
const shell = ['./', 'styles.css', 'app.js', 'demo-api.js', 'presentation.js', 'map.js', 'places.js', 'icon.svg', 'avenida.jpg', 'campus.jpg', 'ribera.jpg', 'app.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'barranquilla.json'];
const scope = self.registration.scope;
const shellURLs = shell.map(path => new URL(path, scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('parche-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('./', scope).href)));
    return;
  }
  const target = new URL(url.href);
  target.search = '';
  if (shellURLs.includes(target.href)) {
    event.respondWith(caches.match(request).then(value => value ?? fetch(request)));
  }
});
