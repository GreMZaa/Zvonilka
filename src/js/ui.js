/**
 * ui.js — Модуль интерфейса
 * Управление DOM-элементами и визуальным состоянием.
 *
 * Фаза 2: Интеграция с WebRTC и отображение статусов соединения в логе.
 *
 * Отвечает за:
 * - Обработку нажатий кнопок (Позвонить / Ответить / Сбросить)
 * - Отображение реальных статусов WebRTC (connecting, connected, failed и т.д.)
 * - Вызовы функций webrtc.js и signaling.js
 */

import { createRoom, joinRoom, cleanup, getState } from './signaling.js';
import { startCall, prepareToReceiveCall, hangUp, onConnectionStateChange } from './webrtc.js';
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

  // Подписываемся на изменения состояния WebRTC-подключения
  onConnectionStateChange((state) => {
    _handleWebRTCStateChange(state);
  });

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
  const roleLabel = role === 'caller' ? 'Звонящий (Caller)' : 'Отвечающий (Callee)';

  appContainer.innerHTML = `
    <div class="screen screen--connected">
      <h1 class="screen__title" id="call-title">📡 Соединение...</h1>
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
}

// ============================
// Обработчики событий
// ============================

/**
 * Обработчик кнопки «Позвонить маме».
 * Создаёт комнату, инициализирует WebRTC-звонок.
 * @private
 */
async function _handleCall() {
  _setStatus('Создание комнаты...');

  try {
    // 1. Создаем комнату в сигналинге
    const roomId = await createRoom();
    log('UI', `Создана комната: ${roomId}. Переход на экран звонка.`);

    // 2. Отображаем экран звонка
    _renderConnectedScreen(roomId, 'caller');
    _addSignalLog(`📌 Комната создана. Код: ${roomId}`);
    _addSignalLog('🎤 Запрос микрофона и генерация offer...');

    // 3. Запускаем логику WebRTC-звонка (запросит микрофон, создаст offer и отправит)
    await startCall();
    _addSignalLog('📤 Offer отправлен. Ожидаем ответ...');

  } catch (err) {
    _setStatus(`❌ Ошибка: ${err.message}`);
    log('UI', `Ошибка при звонке: ${err.message}`);
    _renderIdleScreen();
    _setStatus(`Ошибка: ${err.message}`);
  }
}

/**
 * Обработчик кнопки «Ответить».
 * Присоединяется к комнате, подготавливает WebRTC к приёму звонка.
 * @private
 */
async function _handleJoin() {
  const input = document.getElementById('input-room');
  const roomId = input?.value.trim();

  if (!roomId) {
    _setStatus('⚠️ Введите код комнаты');
    return;
  }

  _setStatus('Подключение к комнате...');

  try {
    // 1. Подключаемся к комнате в сигналинге
    await joinRoom(roomId);
    log('UI', `Присоединились к комнате: ${roomId}`);

    // 2. Переходим на экран звонка
    _renderConnectedScreen(roomId, 'callee');
    _addSignalLog(`📌 Подключено к комнате: ${roomId}`);
    _addSignalLog('⏳ Ожидаем входящий offer от caller...');

    // 3. Подготавливаем WebRTC к прослушиванию входящего offer
    await prepareToReceiveCall();

  } catch (err) {
    _setStatus(`❌ Ошибка: ${err.message}`);
    log('UI', `Ошибка при подключении: ${err.message}`);
    _renderIdleScreen();
    _setStatus(`Ошибка: ${err.message}`);
  }
}

/**
 * Обработчик кнопки «Сбросить».
 * Прерывает звонок и очищает ресурсы.
 * @private
 */
async function _handleHangup() {
  try {
    _addSignalLog('📴 Завершение звонка...');
    await hangUp(true);
  } catch (err) {
    log('UI', `Ошибка при сбросе: ${err.message}`);
  }
  _renderIdleScreen();
}

/**
 * Реагирует на системные изменения статуса подключения WebRTC.
 * @private
 * @param {string} state
 */
function _handleWebRTCStateChange(state) {
  const callTitle = document.getElementById('call-title');
  
  if (callTitle) {
    switch (state) {
      case 'connecting':
        callTitle.textContent = '📡 Соединение...';
        break;
      case 'connected':
        callTitle.textContent = '🟢 Разговор';
        break;
      case 'disconnected':
        callTitle.textContent = '🟡 Обрыв связи...';
        break;
      case 'failed':
        callTitle.textContent = '❌ Ошибка связи';
        break;
      case 'closed':
        callTitle.textContent = '📴 Звонок завершен';
        break;
      case 'timeout':
        callTitle.textContent = '⏳ Таймаут соединения';
        break;
      case 'permission-denied':
        callTitle.textContent = '🎤 Нет доступа';
        break;
      default:
        callTitle.textContent = '📡 Соединение';
    }
  }

  // Добавляем запись в лог на экране
  _addSignalLog(`🔄 Статус WebRTC: ${state}`);

  // Если звонок завершился или произошла фатальная ошибка, возвращаемся в меню через 3 секунды
  if (state === 'closed' || state === 'failed' || state === 'timeout' || state === 'permission-denied') {
    setTimeout(() => {
      // Проверяем, находится ли пользователь всё еще на экране соединения
      const activeHangupBtn = document.getElementById('btn-hangup');
      if (activeHangupBtn) {
        _renderIdleScreen();
        if (state !== 'closed') {
          _setStatus(`Звонок завершен: статус ${state}`);
        }
      }
    }, 3000);
  }
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
