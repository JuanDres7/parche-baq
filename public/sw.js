const cacheName = 'parche-__CACHE_VERSION__';
const shell = ['/', '/styles.css', '/app.js', '/presentation.js', '/map.js', '/places.js', '/icon.svg', '/avenida.jpg', '/campus.jpg', '/ribera.jpg', '/app.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable.png', '/barranquilla.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('parche-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  if (shell.includes(url.pathname)) event.respondWith(caches.open(cacheName).then(cache => cache.match(url.pathname)).then(value => value ?? fetch(request)));
});
