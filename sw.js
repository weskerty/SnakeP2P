const CACHE = 'v1';

const PRE = [
  '/',
  '/index.html',
  '/en.json',
  '/es.json',
  '/game.js',
  '/style.css',
  '/favicon.ico',
  '/ICON.png',
  '/404.html'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRE))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('/404.html'))
    )
  );
});