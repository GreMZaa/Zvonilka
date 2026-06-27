/**
 * ui.js — Модуль интерфейса (Aesthetic: Refined Bio-Minimalism)
 * Управление DOM-элементами, анимациями состояний и таймером звонка.
 *
 * Отвечает за:
 * - Кэширование DOM-элементов
 * - Переключение визуальных состояний (.state-idle, .state-calling, .state-connected и т.д.)
 * - Управление отображением элементов управления (кнопок сброса, принятия)
 * - Отслеживание времени активного звонка (секундомер)
 * - Копирование ID комнаты и сворачивание логов
 * - Тактильную отдачу (Haptic/Vibration) при входящем звонке
 */

import { createRoom, joinRoom, cleanup, getState as getSignalingState } from './signaling.js';
import { startCall, prepareToReceiveCall, acceptIncomingCall, hangUp, onConnectionStateChange, toggleMute } from './webrtc.js';
import { log } from './utils.js';
import { 
  playRingtone, 
  stopRingtone, 
  playDialTone, 
  stopDialTone, 
  playConnectTone, 
  playDisconnectTone 
} from './audio-effects.js';

// === Кэш DOM-элементов ===
let appEl = null;
let callStatusEl = null;
let callTimerEl = null;
let roomBadgeEl = null;
let roomCodeEl = null;
let inputRoomEl = null;
let signalLogEl = null;
let debugWrapperEl = null;

// Кнопки и группы действий
let joinSectionEl = null;
let actionIdleEl = null;
let actionActiveEl = null;
let actionIncomingEl = null;
let btnMuteEl = null;
let historySectionEl = null;
let historyListEl = null;

// === Внутреннее состояние UI ===
let timerInterval = null;
let timerSeconds = 0;
let vibrationInterval = null;
let isCallActive = false; // Отслеживает, был ли звонок соединен

/**
 * Инициализирует интерфейс, кэширует элементы и настраивает слушатели событий.
 */
export function initUI() {
  // Кэшируем основные контейнеры
  appEl = document.getElementById('app');
  callStatusEl = document.getElementById('call-status');
  callTimerEl = document.getElementById('call-timer');
  roomBadgeEl = document.getElementById('room-badge');
  roomCodeEl = document.getElementById('room-code');
  inputRoomEl = document.getElementById('input-room');
  signalLogEl = document.getElementById('signal-log');
  debugWrapperEl = document.getElementById('debug-log-wrapper');
  
  joinSectionEl = document.getElementById('join-section');
  actionIdleEl = document.getElementById('action-idle');
  actionActiveEl = document.getElementById('action-active');
  actionIncomingEl = document.getElementById('action-incoming');
  
  btnMuteEl = document.getElementById('btn-mute');
  historySectionEl = document.getElementById('history-section');
  historyListEl = document.getElementById('history-list');

  if (!appEl) {
    log('UI', '❌ Критическая ошибка: корневой элемент #app не найден.');
    return;
  }

  // Привязка событий кнопок
  document.getElementById('btn-call').addEventListener('click', _handleCallClick);
  document.getElementById('btn-join').addEventListener('click', _handleJoinClick);
  document.getElementById('btn-hangup').addEventListener('click', _handleHangupClick);
  document.getElementById('btn-decline').addEventListener('click', _handleHangupClick);
  document.getElementById('btn-accept').addEventListener('click', _handleAcceptClick);
  document.getElementById('btn-copy').addEventListener('click', _handleCopyClick);
  document.getElementById('btn-toggle-log').addEventListener('click', _handleToggleLogClick);
  
  btnMuteEl.addEventListener('click', _handleMuteClick);
  document.getElementById('btn-toggle-history').addEventListener('click', _handleToggleHistoryClick);

  // Подписка на статусы WebRTC
  onConnectionStateChange((state) => {
    _transitionToState(state);
  });

  // Инициализируем начальный экран (idle)
  _transitionToState('closed');
  _renderHistory();

  log('UI', '✅ Интерфейс и обработчики событий настроены.');
}

// ============================
// Логика перехода по состояниям
// ============================

/**
 * Переводит интерфейс в одно из состояний связи.
 * Доступные состояния:
 * - 'closed' / 'idle' (Ожидание)
 * - 'connecting' (Вызов/подключение)
 * - 'connected' (Разговор)
 * - 'incoming' (Входящий вызов)
 * - 'failed' (Ошибка соединения)
 * - 'timeout' (Таймаут соединения)
 * - 'permission-denied' (Ошибка микрофона)
 *
 * @private
 * @param {string} state
 */
function _transitionToState(state) {
  log('UI', `🎭 Переход интерфейса в состояние: ${state}`);
  
  // Если звонок завершается, сохраняем его в историю
  if (isCallActive && (state === 'closed' || state === 'failed' || state === 'timeout' || state === 'permission-denied' || state === 'idle')) {
    _saveCallToHistory();
  }

  // 1. Очищаем все классы состояния у корневого элемента
  appEl.className = 'app-container';
  _stopVibration();
  _stopTimer();
  
  // Останавливаем все фоновые циклы звуков
  stopRingtone();
  stopDialTone();

  // Сбрасываем кнопку Mute
  if (btnMuteEl) {
    btnMuteEl.classList.remove('muted');
  }

  // Добавляем соответствующий класс состояния
  const mappedClass = _mapStateToClass(state);
  appEl.classList.add(mappedClass);

  // Получаем текущие данные сигналинга
  const sigState = getSignalingState();

  // 2. Обновляем элементы управления и тексты
  switch (state) {
    case 'closed':
    case 'idle':
      _updateText(callStatusEl, 'Готов к звонку');
      _hide(callTimerEl);
      _hide(roomBadgeEl);
      _show(joinSectionEl);
      _show(historySectionEl); // Показываем секцию истории в меню
      
      _show(actionIdleEl);
      _hide(actionActiveEl);
      _hide(actionIncomingEl);
      break;

    case 'connecting':
      const isCaller = sigState.role === 'caller';
      _updateText(callStatusEl, isCaller ? 'Звоним маме...' : 'Подключение...');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _updateText(roomCodeEl, sigState.roomId || '------');
      _hide(joinSectionEl);
      _hide(historySectionEl); // Скрываем историю во время звонка
      
      _hide(actionIdleEl);
      _show(actionActiveEl);
      _hide(actionIncomingEl);

      // Если мы звонящие (caller), запускаем гудки ожидания
      if (isCaller) {
        playDialTone();
      }
      break;

    case 'connected':
      isCallActive = true; // Отмечаем, что звонок успешно начался
      _updateText(callStatusEl, 'На связи');
      _show(callTimerEl);
      _startTimer();
      _show(roomBadgeEl);
      _updateText(roomCodeEl, sigState.roomId || '------');
      _hide(joinSectionEl);
      _hide(historySectionEl);
      
      _hide(actionIdleEl);
      _show(actionActiveEl);
      _hide(actionIncomingEl);

      // Проигрываем звук подключения
      playConnectTone();
      break;

    case 'incoming':
      _updateText(callStatusEl, 'Мама звонит!');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _updateText(roomCodeEl, sigState.roomId || '------');
      _hide(joinSectionEl);
      _hide(historySectionEl);
      
      _hide(actionIdleEl);
      _hide(actionActiveEl);
      _show(actionIncomingEl);
      
      // Запускаем вибрацию и рингтон входящего звонка
      _startVibration();
      playRingtone();
      break;

    case 'failed':
      _updateText(callStatusEl, 'Ошибка связи');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _hide(joinSectionEl);
      _hide(historySectionEl);
      _show(actionActiveEl);
      _addSignalLog('❌ Соединение не удалось установить или оборвалось.');

      // Проигрываем звук сброса/ошибки
      playDisconnectTone();
      break;

    case 'timeout':
      _updateText(callStatusEl, 'Лимит ожидания');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _hide(joinSectionEl);
      _hide(historySectionEl);
      _show(actionActiveEl);
      _addSignalLog('⏳ Превышено время ожидания ответа.');

      // Проигрываем звук сброса/ошибки
      playDisconnectTone();
      break;

    case 'permission-denied':
      _updateText(callStatusEl, 'Нет микрофона');
      _hide(callTimerEl);
      _hide(roomBadgeEl);
      _hide(joinSectionEl);
      _hide(historySectionEl);
      _show(actionActiveEl);
      _addSignalLog('⚠️ Ошибка: запрещен доступ к микрофону.');

      // Проигрываем звук сброса/ошибки
      playDisconnectTone();
      break;

    default:
      _updateText(callStatusEl, 'Соединение...');
  }

  _addSignalLog(`🔄 Статус WebRTC: ${state}`);
}

// ============================
// Обработчики кнопок
// ============================

/**
 * Кнопка «Позвонить маме»
 * @private
 */
async function _handleCallClick() {
  _updateText(callStatusEl, 'Создание комнаты...');
  _addSignalLog('📞 Инициация вызова...');
  
  try {
    const roomId = await createRoom();
    _transitionToState('connecting');
    await startCall();
  } catch (err) {
    _addSignalLog(`❌ Ошибка инициации: ${err.message}`);
    _transitionToState('closed');
  }
}

/**
 * Кнопка «Войти» (ответ по коду)
 * @private
 */
async function _handleJoinClick() {
  const roomId = inputRoomEl.value.trim().toUpperCase();
  if (!roomId || roomId.length < 4) {
    _addSignalLog('⚠️ Введите корректный код комнаты');
    return;
  }

  _updateText(callStatusEl, 'Вход в комнату...');
  _addSignalLog(`📱 Присоединение к комнате ${roomId}...`);

  try {
    await joinRoom(roomId);
    _transitionToState('connecting');
    await prepareToReceiveCall();
  } catch (err) {
    _addSignalLog(`❌ Ошибка подключения: ${err.message}`);
    _transitionToState('closed');
  }
}

/**
 * Кнопка «Ответить» (принять входящий)
 * @private
 */
async function _handleAcceptClick() {
  _addSignalLog('🟢 Принятие вызова...');
  try {
    await acceptIncomingCall();
  } catch (err) {
    _addSignalLog(`❌ Не удалось ответить: ${err.message}`);
    _transitionToState('closed');
  }
}

/**
 * Кнопка «Сбросить» / «Отклонить»
 * @private
 */
async function _handleHangupClick() {
  _addSignalLog('📴 Сброс соединения...');
  try {
    await hangUp(true);
  } catch (err) {
    log('UI', `Ошибка при сбросе: ${err.message}`);
  }
  _transitionToState('closed');
}

/**
 * Копирование кода в буфер
 * @private
 */
function _handleCopyClick() {
  const sigState = getSignalingState();
  if (sigState.roomId) {
    navigator.clipboard.writeText(sigState.roomId)
      .then(() => {
        _addSignalLog('📋 Код комнаты скопирован в буфер обмена');
        // Быстрая анимация кнопки
        const btn = document.getElementById('btn-copy');
        btn.style.transform = 'scale(1.3)';
        setTimeout(() => btn.style.transform = '', 200);
      })
      .catch(err => log('UI', `Не удалось скопировать: ${err.message}`));
  }
}

/**
 * Переключатель видимости лога сигналинга
 * @private
 */
function _handleToggleLogClick() {
  const btn = document.getElementById('btn-toggle-log');
  const isCollapsed = debugWrapperEl.classList.toggle('collapsed');
  
  if (isCollapsed) {
    btn.textContent = 'Детали соединения ▾';
  } else {
    btn.textContent = 'Свернуть детали ▴';
  }
}

// ============================
// Вспомогательные функции UI
// ============================

function _show(el) {
  if (el) el.classList.remove('hidden');
}

function _hide(el) {
  if (el) el.classList.add('hidden');
}

function _updateText(el, text) {
  if (el) el.textContent = text;
}

function _mapStateToClass(state) {
  switch (state) {
    case 'connecting': return 'state-calling';
    case 'connected': return 'state-connected';
    case 'incoming': return 'state-incoming';
    case 'failed': return 'state-failed';
    case 'timeout': return 'state-failed';
    case 'permission-denied': return 'state-denied';
    default: return 'state-idle';
  }
}

/**
 * Добавляет лог в окно отладки
 * @private
 * @param {string} msg
 */
function _addSignalLog(msg) {
  if (!signalLogEl) return;
  const entry = document.createElement('div');
  entry.className = 'signal-log__entry';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  signalLogEl.appendChild(entry);
  signalLogEl.scrollTop = signalLogEl.scrollHeight;
}

// ============================
// Таймер разговора
// ============================

function _startTimer() {
  _stopTimer();
  timerSeconds = 0;
  callTimerEl.textContent = '00:00';
  
  timerInterval = setInterval(() => {
    timerSeconds++;
    const mins = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const secs = String(timerSeconds % 60).padStart(2, '0');
    callTimerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function _stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerSeconds = 0;
}

// ============================
// Haptic Feedback / Вибрация
// ============================

function _startVibration() {
  _stopVibration();
  if ('vibrate' in navigator) {
    // Паттерн вибрации: 600мс вибрируем, 600мс пауза
    const vibrate = () => navigator.vibrate([600, 600]);
    vibrate();
    vibrationInterval = setInterval(vibrate, 1200);
  }
}

function _stopVibration() {
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
  }
  if ('vibrate' in navigator) {
    navigator.vibrate(0);
  }
}

// ============================
// Обработчики Mute и Истории
// ============================

/**
 * Переключатель отключения микрофона
 * @private
 */
function _handleMuteClick() {
  const isMuted = toggleMute();
  if (isMuted) {
    btnMuteEl.classList.add('muted');
    _addSignalLog('🔇 Ваш микрофон отключен');
  } else {
    btnMuteEl.classList.remove('muted');
    _addSignalLog('🎤 Ваш микрофон включен');
  }
}

/**
 * Переключатель видимости панели истории
 * @private
 */
function _handleToggleHistoryClick() {
  const btn = document.getElementById('btn-toggle-history');
  const isHidden = historyListEl.classList.toggle('hidden');
  
  if (isHidden) {
    btn.textContent = '⏳ История звонков';
  } else {
    btn.textContent = '⏳ Скрыть историю';
    _renderHistory(); // Перерисовываем актуальный список при открытии
  }
}

// ============================
// Работа с Историей (Local Storage)
// ============================

/**
 * Сохраняет информацию о прошедшем звонке в историю.
 * @private
 */
function _saveCallToHistory() {
  const sigState = getSignalingState();
  const durationStr = callTimerEl.textContent;
  
  const callRecord = {
    id: Date.now(),
    role: sigState.role || 'caller',
    date: new Date().toLocaleDateString([], { day: '2-digit', month: '2-digit' }),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    duration: durationStr
  };

  try {
    const rawHistory = localStorage.getItem('zvonilka_call_history') || '[]';
    const history = JSON.parse(rawHistory);
    
    // Добавляем в начало и ограничиваем до 5 записей
    history.unshift(callRecord);
    if (history.length > 5) history.pop();
    
    localStorage.setItem('zvonilka_call_history', JSON.stringify(history));
    log('UI', '✅ Звонок сохранен в историю звонков.');
  } catch (err) {
    log('UI', `⚠️ Не удалось сохранить звонок в историю: ${err.message}`);
  }

  isCallActive = false; // Сбрасываем флаг активности
}

/**
 * Считывает и отображает историю звонков.
 * @private
 */
function _renderHistory() {
  if (!historyListEl) return;

  try {
    const rawHistory = localStorage.getItem('zvonilka_call_history') || '[]';
    const history = JSON.parse(rawHistory);

    if (history.length === 0) {
      historyListEl.innerHTML = `
        <div class="history-item" style="justify-content: center; color: var(--text-muted);">
          История звонков пуста
        </div>
      `;
      return;
    }

    historyListEl.innerHTML = history.map(item => {
      const isOut = item.role === 'caller';
      const directionIcon = isOut ? '↗️' : '↙️';
      const directionClass = isOut ? 'history-item--out' : 'history-item--in';
      const nameText = isOut ? 'Исходящий' : 'Входящий';

      return `
        <div class="history-item ${directionClass}">
          <div class="history-item__info">
            <span class="history-item__direction">${directionIcon}</span>
            <div class="history-item__meta">
              <span class="history-item__name">${nameText}</span>
              <span class="history-item__time">${item.date}, ${item.time}</span>
            </div>
          </div>
          <span class="history-item__duration">${item.duration}</span>
        </div>
      `;
    }).join('');

  } catch (err) {
    log('UI', `⚠️ Ошибка рендеринга истории: ${err.message}`);
    historyListEl.innerHTML = `<div class="history-item" style="color: var(--color-danger);">Ошибка чтения истории</div>`;
  }
}

