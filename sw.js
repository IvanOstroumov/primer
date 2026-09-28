// Сервис-воркер: всё приложение кэшируется при установке и работает офлайн.
// При изменении файлов увеличьте VERSION.
const VERSION = 'zal-v3';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'content/research.md',
  'js/app.js', 'js/db.js', 'js/load.js', 'js/screens/exercise.js', 'js/util.js', 'js/state.js', 'js/seed.js', 'js/timer.js', 'js/charts.js', 'js/photos.js', 'js/md.js',
  'js/screens/today.js', 'js/screens/program.js', 'js/screens/body.js', 'js/screens/ramp.js',
  'js/screens/plan.js', 'js/screens/research.js', 'js/screens/settings.js',
  'fonts/onest-cyr.woff2', 'fonts/onest-lat.woff2', 'fonts/unb-cyr.woff2', 'fonts/unb-lat.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});

// Нажатие на уведомление таймера — вернуться в приложение
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow('./#today')));
});
