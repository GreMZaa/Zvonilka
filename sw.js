/**
 * Service Worker — Офлайн-кеширование для PWA (совместимо с GitHub Pages)
 *
 * Кеширует статические ресурсы при установке,
 * отдаёт из кеша при потере сети.
 * Запросы к Supabase и другим сторонним доменам всегда идут по сети.
 */

const CACHE_NAME = 'zvonilka-v1.2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/css/styles.css',
  './src/css/animations.css',
  './src/js/app.js',
  './src/js/webrtc.js',
  './src/js/signaling.js',
  './src/js/ui.js',
  './src/js/config.js',
  './src/js/utils.js',
  './src/js/audio-effects.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// Установка — кешируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Кеширование статических ресурсов...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация — удаляем старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log(`[Service Worker] Удаление старого кеша: ${k}`);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// Запросы — сеть с фолбэком на кеш
self.addEventListener('fetch', (event) => {
  // Для запросов к сторонним API (Supabase и т.д.) не используем кеш
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Игнорируем websocket-запросы (в Supabase realtime)
  if (event.request.url.includes('websocket') || event.request.url.includes('realtime')) return;

  event.respondWith(
    fetch(event.request).catch(() => {
      // Ищем совпадение в кеше
      return caches.match(event.request).then((response) => {
        if (response) return response;
        // Если запрашивался корень, пробуем отдать index.html
        if (event.request.url === self.location.origin + '/' || event.request.url.endsWith('/')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
