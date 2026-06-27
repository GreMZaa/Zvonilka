/**
 * ui.js — Модуль интерфейса
 * Управление DOM-элементами и визуальным состоянием.
 *
 * Фаза 1: Минимальный тестовый интерфейс для проверки сигналинга.
 * Фаза 3: Будет переписан на полноценный UI с анимациями.
 *
 * Отвечает за:
 * - Обработку нажатий кнопок (Позвонить / Ответить / Сбросить)
 * - Обновление статуса соединения
 * - Анимации и визуальная обратная связь
 */

import { createRoom, joinRoom, sendSignal, onSignal, cleanup, getState } from './signaling.js';
import { log } from './utils.js';

/** @type {HTMLElement} */
let appContainer = null;

/**
 * Инициализирует интерфейс.
 * Создаёт DOM-элементы и привязывает события.
 */
export function initUI() {
  appContainer = document.getElementById('app');
  if (!appContainer) {
    log('UI', '❌ Контейнер #app не найден!');
    return;
  }

  _renderIdleScreen();
  log('UI', '✅ Интерфейс загружен.');
}

// ============================
// Экраны
// ============================

/**
 * Экран ожидания — две кнопки: Позвонить и Ответить.
 * @private
 */
function _renderIdleScreen() {
  appContainer.innerHTML = `
    <div class="screen screen--idle">
      <h1 class="screen__title">📞 Звонилка</h1>
      <p class="screen__subtitle">Готов к звонку</p>

      <div class="screen__actions">
        <button id="btn-call" class="btn btn--primary">
          Позвонить маме
        </button>
      </div>

      <div class="screen__join">
        <p class="screen__label">Или введи код комнаты:</p>
        <div class="join-form">
          <input
            id="input-room"
            type="text"
            class="input"
            placeholder="Код комнаты"
            maxlength="8"
            autocomplete="off"
          />
          <button id="btn-join" class="btn btn--secondary">
            Ответить
          </button>
        </div>
      </div>

      <div id="status-area" class="screen__status"></div>
    </div>
  `;

  // Привязка событий
  document.getElementById('btn-call').addEventListener('click', _handleCall);
  document.getElementById('btn-join').addEventListener('click', _handleJoin);
}

/**
 * Экран активного соединения — показывает комнату и кнопку сброса.
 * @private
 * @param {string} roomId
 * @param {'caller' | 'callee'} role
 */
function _renderConnectedScreen(roomId, role) {
  const roleLabel = role === 'caller' ? 'Звонящий' : 'Отвечающий';

  appContainer.innerHTML = `
    <div class="screen screen--connected">
      <h1 class="screen__title">📡 На связи</h1>
      <p class="screen__subtitle">${roleLabel}</p>

      <div class="room-info">
        <span class="room-info__label">Комната:</span>
        <code class="room-info__code" id="room-code">${roomId}</code>
        <button id="btn-copy" class="btn btn--small" title="Скопировать">📋</button>
      </div>

      <div id="signal-log" class="signal-log"></div>

      <div class="screen__actions">
        <button id="btn-hangup" class="btn btn--danger">
          Сбросить
        </button>
      </div>
    </div>
  `;

  // Привязка событий
  document.getElementById('btn-hangup').addEventListener('click', _handleHangup);
  document.getElementById('btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(roomId).then(() => {
      _addSignalLog('📋 Код скопирован!');
    });
  });

  // Подписаться на входящие сигналы и выводить в лог
  onSignal((signal) => {
    _addSignalLog(`📥 ${signal.type} от ${signal.sender}`);
  });
}

// ============================
// Обработчики событий
// ============================

/**
 * Обработчик кнопки «Позвонить маме».
 * Создаёт комнату и переключает экран.
 * @private
 */
async function _handleCall() {
  _setStatus('Создаю комнату...');

  try {
    const roomId = await createRoom();
    log('UI', `Комната создана: ${roomId}`);

    // Отправить тестовый сигнал, чтобы убедиться что всё работает
    await sendSignal('offer', { test: true, message: 'Привет от caller!' });

    _renderConnectedScreen(roomId, 'caller');
    _addSignalLog('✅ Комната создана. Жду ответчика...');
    _addSignalLog(`📌 Код комнаты: ${roomId}`);
  } catch (err) {
    _setStatus(`❌ Ошибка: ${err.message}`);
    log('UI', `Ошибка создания комнаты: ${err.message}`);
  }
}

/**
 * Обработчик кнопки «Ответить».
 * Присоединяется к комнате по введённому коду.
 * @private
 */
async function _handleJoin() {
  const input = document.getElementById('input-room');
  const roomId = input?.value.trim();

  if (!roomId) {
    _setStatus('⚠️ Введите код комнаты');
    return;
  }

  _setStatus('Подключаюсь...');

  try {
    await joinRoom(roomId);
    log('UI', `Подключён к комнате: ${roomId}`);

    // Отправить ответный сигнал
    await sendSignal('answer', { test: true, message: 'Привет от callee!' });

    _renderConnectedScreen(roomId, 'callee');
    _addSignalLog('✅ Подключён к комнате!');
  } catch (err) {
    _setStatus(`❌ Ошибка: ${err.message}`);
    log('UI', `Ошибка подключения: ${err.message}`);
  }
}

/**
 * Обработчик кнопки «Сбросить».
 * Завершает соединение и возвращает на главный экран.
 * @private
 */
async function _handleHangup() {
  try {
    await cleanup();
    log('UI', 'Звонок завершён.');
  } catch (err) {
    log('UI', `Ошибка при сбросе: ${err.message}`);
  }

  _renderIdleScreen();
}

// ============================
// Вспомогательные функции UI
// ============================

/**
 * Показывает статусное сообщение на экране ожидания.
 * @private
 * @param {string} message
 */
function _setStatus(message) {
  const statusArea = document.getElementById('status-area');
  if (statusArea) {
    statusArea.textContent = message;
  }
}

/**
 * Добавляет запись в лог сигналов (экран соединения).
 * @private
 * @param {string} message
 */
function _addSignalLog(message) {
  const logArea = document.getElementById('signal-log');
  if (!logArea) return;

  const entry = document.createElement('div');
  entry.className = 'signal-log__entry';

  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;

  logArea.appendChild(entry);
  logArea.scrollTop = logArea.scrollHeight;
}
