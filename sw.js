/**
 * Service Worker — Офлайн-кеширование для PWA
 * 
 * Кеширует статические ресурсы при установке,
 * отдаёт из кеша при потере сети.
 * Динамические запросы (Supabase) всегда идут по сети.
 */

const CACHE_NAME = 'zvonilka-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/src/css/styles.css',
  '/src/css/animations.css',
  '/src/js/app.js',
  '/src/js/webrtc.js',
  '/src/js/signaling.js',
  '/src/js/ui.js',
  '/src/js/config.js',
  '/src/js/utils.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// Установка — кешируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Активация — удаляем старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Запросы — сеть с фолбэком на кеш
self.addEventListener('fetch', (event) => {
  // Supabase и внешние запросы — только сеть
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
