// Сервис-воркер: всё приложение кэшируется при установке и работает офлайн.
// При изменении файлов увеличьте VERSION.
const VERSION = 'zal-v8';
const ASSETS = [
  './', 'manifest.webmanifest', 'css/app.css', 'content/research.md',
  'js/app.js', 'js/db.js', 'js/load.js', 'js/screens/exercise.js', 'js/util.js', 'js/state.js', 'js/seed.js', 'js/timer.js', 'js/charts.js', 'js/photos.js', 'js/md.js',
  'js/screens/today.js', 'js/screens/body.js', 'js/screens/ramp.js',
  'js/screens/plan.js', 'js/screens/research.js', 'js/screens/settings.js',
  'fonts/onest-cyr.woff2', 'fonts/onest-lat.woff2', 'fonts/unb-cyr.woff2', 'fonts/unb-lat.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

// Кэшируем каждый файл по отдельности: один неудачный запрос не должен
// срывать установку остальных (раньше cache.addAll падал целиком при любой
// осечке, и тогда fetch-обработчик мог зависнуть на отклонённом промисе —
// Chrome в этом случае показывает net::ERR_FAILED без объяснений).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {}),
  );
});

// Всегда есть сетевой запасной путь: если кэш промахнулся или сам упал
// с ошибкой, идём в сеть; если и сеть недоступна — отдаём offline-страницу
// вместо того, чтобы дать промису отклониться (это и даёт ERR_FAILED).
// Cloudflare Pages перенаправляет /index.html → / (308). Перенаправленный ответ нельзя
// отдавать на навигацию — Chrome показывает ERR_FAILED. Поэтому страницу кэшируем как './'
// и любой ответ с флагом redirected пересобираем в «чистый».
function clean(r) {
  if (!r || !r.redirected) return r;
  return r.blob().then(body => new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers }));
}

async function handle(req, navigate) {
  try {
    const cached = await caches.match(navigate ? './' : req, navigate ? undefined : { ignoreSearch: true });
    if (cached) return await clean(cached);
  } catch { /* кэш недоступен — идём в сеть */ }
  try {
    return await clean(await fetch(req));
  } catch {
    if (navigate) { const idx = await caches.match('./'); if (idx) return await clean(idx); }
    return new Response('Офлайн: страница ещё не была загружена.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(handle(req, req.mode === 'navigate'));
});

// Нажатие на уведомление таймера — вернуться в приложение
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow('./#today')));
});
