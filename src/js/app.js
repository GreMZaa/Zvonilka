/**
 * app.js — Точка входа приложения "Звонилка"
 * Инициализация модулей и запуск приложения.
 */

import { initUI } from './ui.js';
import { initSignaling } from './signaling.js';
import { initWebRTC } from './webrtc.js';
import { log } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
  log('App', 'Инициализация...');

  // 1. Сигналинг — первым, т.к. от него зависят WebRTC и UI
  initSignaling();

  // 2. WebRTC — зависит от сигналинга
  initWebRTC();

  // 3. UI — последним, когда все модули готовы
  initUI();

  // 4. Service Worker — регистрация для PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        log('App', '✅ Service Worker зарегистрирован.');
        
        // Слушаем появление нового сервис-воркера для автообновления
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                log('App', '🔄 Доступно обновление! Перезапуск страницы...');
                window.location.reload();
              }
            });
          }
        });
      })
      .catch((err) => log('App', `⚠️ Service Worker не удалось зарегистрировать: ${err.message}`));
  }

  log('App', '✅ Готово.');
});
