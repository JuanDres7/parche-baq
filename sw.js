const cacheName = 'parche-c8ee84dfab1c';
const shell = ['/', '/assets-c8ee84dfab1c/styles.css', '/assets-c8ee84dfab1c/app.js', '/assets-c8ee84dfab1c/demo-api.js', '/assets-c8ee84dfab1c/presentation.js', '/assets-c8ee84dfab1c/map.js', '/assets-c8ee84dfab1c/places.js', '/assets-c8ee84dfab1c/icon.svg', '/avenida.jpg', '/campus.jpg', '/ribera.jpg', '/assets-c8ee84dfab1c/app.webmanifest', '/assets-c8ee84dfab1c/icon-192.png', '/assets-c8ee84dfab1c/icon-512.png', '/assets-c8ee84dfab1c/icon-maskable.png', '/barranquilla.json'];

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
