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

import {
  createRoom,
  joinRoom,
  cleanup,
  getState as getSignalingState,
  onPeerPresenceChange,
  initPersonalChannel,
  sendCallInvite,
  sendCallResponse
} from './signaling.js';
import { startCall, prepareToReceiveCall, acceptIncomingCall, hangUp, onConnectionStateChange, toggleMute, onQualityChange, setMicrophoneId } from './webrtc.js';
import { log } from './utils.js';
import { 
  playRingtone, 
  stopRingtone, 
  playDialTone, 
  stopDialTone, 
  playConnectTone, 
  playDisconnectTone,
  setRingtoneVolume
} from './audio-effects.js';
import {
  getLocalProfile,
  createProfile,
  updateLocalNickname,
  loadFriends,
  addFriendByCode,
  removeFriend,
  subscribeToFriends,
  initPresence
} from './profile.js';


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
let btnSpeakerEl = null;
let historySectionEl = null;
let historyListEl = null;

// Новые элементы: Присутствие и Качество
let peerStatusEl = null;
let connQualityEl = null;
let callMetaEl = null;

// Настройки
let btnSettingsEl = null;
let settingsModalEl = null;
let btnCloseSettingsEl = null;
let selectMicEl = null;
let rangeVolumeEl = null;
let btnTestMicEl = null;
let micMeterBarEl = null;
let btnSaveSettingsEl = null;

// Профиль и друзья (Новые)
let onboardingModalEl = null;
let inputOnboardNicknameEl = null;
let onboardErrorEl = null;
let btnSaveOnboardEl = null;

let myNicknameEl = null;
let myCodeEl = null;
let btnCopyMyCodeEl = null;

let inputFriendCodeEl = null;
let btnAddFriendEl = null;
let addFriendErrorEl = null;

let friendsListEl = null;

let screenChatsEl = null;
let screenHistoryEl = null;
let screenSettingsEl = null;
let screenCallEl = null;

let tabChatsEl = null;
let tabHistoryEl = null;
let tabSettingsEl = null;

let btnQuickRoomEl = null;
let manualJoinModalEl = null;
let btnCloseManualJoinEl = null;
let inputEditNicknameEl = null;


// === Внутреннее состояние UI ===
let timerInterval = null;
let timerSeconds = 0;
let vibrationInterval = null;
let isCallActive = false; // Отслеживает, был ли звонок соединен
let currentCallPeerName = '';
let incomingCallRoomId = null;
let incomingCallCallerId = null;
let callingTimeoutId = null;


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
  btnSpeakerEl = document.getElementById('btn-speaker');
  historySectionEl = document.getElementById('history-section');
  historyListEl = document.getElementById('history-list');

  // Новые элементы
  peerStatusEl = document.getElementById('peer-status');
  connQualityEl = document.getElementById('conn-quality');
  callMetaEl = document.getElementById('call-meta');

  btnSettingsEl = document.getElementById('btn-settings');
  settingsModalEl = document.getElementById('settings-modal');
  btnCloseSettingsEl = document.getElementById('btn-close-settings');
  selectMicEl = document.getElementById('select-mic');
  rangeVolumeEl = document.getElementById('range-volume');
  btnTestMicEl = document.getElementById('btn-test-mic');
  micMeterBarEl = document.getElementById('mic-meter-bar');
  btnSaveSettingsEl = document.getElementById('btn-save-settings');

  // Инициализируем новые DOM-элементы профиля и друзей
  onboardingModalEl = document.getElementById('onboarding-modal');
  inputOnboardNicknameEl = document.getElementById('input-onboard-nickname');
  onboardErrorEl = document.getElementById('onboard-error');
  btnSaveOnboardEl = document.getElementById('btn-save-onboard');

  myNicknameEl = document.getElementById('my-nickname');
  myCodeEl = document.getElementById('my-code');
  btnCopyMyCodeEl = document.getElementById('btn-copy-my-code');

  inputFriendCodeEl = document.getElementById('input-friend-code');
  btnAddFriendEl = document.getElementById('btn-add-friend');
  addFriendErrorEl = document.getElementById('add-friend-error');

  friendsListEl = document.getElementById('friends-list');

  screenChatsEl = document.getElementById('screen-chats');
  screenHistoryEl = document.getElementById('screen-history');
  screenSettingsEl = document.getElementById('screen-settings');
  screenCallEl = document.getElementById('screen-call');

  tabChatsEl = document.getElementById('tab-chats');
  tabHistoryEl = document.getElementById('tab-history');
  tabSettingsEl = document.getElementById('tab-settings');

  btnQuickRoomEl = document.getElementById('btn-quick-room');
  manualJoinModalEl = document.getElementById('manual-join-modal');
  btnCloseManualJoinEl = document.getElementById('btn-close-manual-join');
  inputEditNicknameEl = document.getElementById('input-edit-nickname');


  if (!appEl) {
    log('UI', '❌ Критическая ошибка: корневой элемент #app не найден.');
    return;
  }

  // Привязка событий кнопок с защитой от отсутствующих элементов (кеш PWA)
  const safeBind = (idOrEl, event, handler) => {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (el) {
      el.addEventListener(event, handler);
    } else {
      log('UI', `⚠️ Элемент [${typeof idOrEl === 'string' ? '#' + idOrEl : 'DOM Element'}] не найден. Пропуск привязки.`);
    }
  };

  safeBind('btn-call', 'click', _handleCallClick);
  safeBind('btn-join', 'click', _handleJoinClick);
  safeBind('btn-hangup', 'click', _handleHangupClick);
  safeBind('btn-decline', 'click', _handleHangupClick);
  safeBind('btn-accept', 'click', _handleAcceptClick);
  safeBind('btn-copy', 'click', _handleCopyClick);
  safeBind('btn-toggle-log', 'click', _handleToggleLogClick);
  
  if (btnMuteEl) safeBind(btnMuteEl, 'click', _handleMuteClick);
  if (btnSpeakerEl) safeBind(btnSpeakerEl, 'click', _handleSpeakerClick);

  // Табы
  safeBind('tab-chats', 'click', () => _switchToTab('chats'));
  safeBind('tab-history', 'click', () => _switchToTab('history'));
  safeBind('tab-settings', 'click', () => _switchToTab('settings'));

  // Быстрая комната
  safeBind('btn-quick-room', 'click', _handleOpenQuickRoomClick);
  safeBind('btn-close-manual-join', 'click', _handleCloseQuickRoomClick);

  // Обработчики настроек
  if (btnCloseSettingsEl) safeBind(btnCloseSettingsEl, 'click', _handleCloseSettingsClick);
  if (btnSaveSettingsEl) safeBind(btnSaveSettingsEl, 'click', _handleSaveSettingsClick);
  if (btnTestMicEl) safeBind(btnTestMicEl, 'click', _handleTestMicClick);
  if (rangeVolumeEl) {
    rangeVolumeEl.addEventListener('input', (e) => {
      setRingtoneVolume(parseFloat(e.target.value));
    });
  }

  // Загрузка сохраненной громкости
  const savedVolume = localStorage.getItem('zvonilka_ringtone_volume');
  if (savedVolume !== null) {
    const vol = parseFloat(savedVolume);
    setRingtoneVolume(vol);
    if (rangeVolumeEl) rangeVolumeEl.value = vol;
  }

  // Обработчики для профиля и друзей
  if (btnSaveOnboardEl) safeBind(btnSaveOnboardEl, 'click', _handleSaveOnboardClick);
  if (btnCopyMyCodeEl) safeBind(btnCopyMyCodeEl, 'click', _handleCopyMyCodeClick);
  if (btnAddFriendEl) safeBind(btnAddFriendEl, 'click', _handleFriendAddClick);

  // Подписка на статусы WebRTC
  onConnectionStateChange((state) => {
    _transitionToState(state);
  });

  // Подписка на изменение качества связи
  onQualityChange((quality) => {
    _handleQualityChange(quality);
  });

  // Подписка на онлайн-статус партнера
  onPeerPresenceChange((isOnline) => {
    _handlePeerPresenceChange(isOnline);
  });

  // Инициализируем начальный экран (idle)
  _transitionToState('closed');
  _renderHistory();

  // Проверяем наличие локального профиля
  const profile = getLocalProfile();
  if (!profile) {
    if (onboardingModalEl) {
      onboardingModalEl.classList.remove('hidden');
    }
    log('UI', 'ℹ️ Профиль отсутствует. Отображается экран онбординга.');
  } else {
    _onProfileLoaded(profile);
  }

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
  if (appEl) {
    appEl.className = 'app-container';
  }
  _stopVibration();
  _stopTimer();
  
  // Устанавливаем data-state на body для переключения стилей
  let dataState = 'idle';
  switch (state) {
    case 'connecting': dataState = 'calling'; break;
    case 'connected': dataState = 'connected'; break;
    case 'incoming': dataState = 'ringing'; break;
    case 'failed':
    case 'timeout':
    case 'permission-denied': dataState = 'failed'; break;
    default: dataState = 'idle';
  }
  document.body.setAttribute('data-state', dataState);
  
  // Останавливаем все фоновые циклы звуков
  stopRingtone();
  stopDialTone();

  // Сбрасываем кнопку Mute
  if (btnMuteEl) {
    btnMuteEl.classList.remove('muted');
  }

  // Сбрасываем отображение качества и присутствия
  _hide(callMetaEl);
  if (peerStatusEl) {
    peerStatusEl.className = 'peer-status';
    peerStatusEl.textContent = '● Не в сети';
  }
  if (connQualityEl) {
    connQualityEl.textContent = '📶 Ожидание';
  }

  // Добавляем соответствующий класс состояния
  const mappedClass = _mapStateToClass(state);
  if (appEl) {
    appEl.classList.add(mappedClass);
  }

  // Получаем текущие данные сигналинга
  const sigState = getSignalingState();

  // Управление отображением экрана звонка
  if (state === 'closed' || state === 'idle') {
    _hide(screenCallEl);
    
    // Сбрасываем таймер таймаута вызова
    if (callingTimeoutId) {
      clearTimeout(callingTimeoutId);
      callingTimeoutId = null;
    }
  } else {
    _show(screenCallEl);
  }

  // 2. Обновляем элементы управления и тексты
  switch (state) {
    case 'closed':
    case 'idle':
      _updateText(callStatusEl, 'Готов к звонку');
      _hide(callTimerEl);
      _hide(roomBadgeEl);
      
      _show(actionIdleEl);
      _hide(actionActiveEl);
      _hide(actionIncomingEl);
      break;

    case 'connecting':
      const isCaller = sigState.role === 'caller';
      _updateText(callStatusEl, isCaller ? 'Вызов...' : 'Подключение...');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _updateText(roomCodeEl, sigState.roomId || '------');
      _show(callMetaEl);
      
      _hide(actionIdleEl);
      _show(actionActiveEl);
      _hide(actionIncomingEl);

      // Если мы звонящие (caller), запускаем гудки ожидания
      if (isCaller) {
        playDialTone();
      }
      break;

    case 'connected':
      isCallActive = true;
      _updateText(callStatusEl, 'На связи');
      _show(callTimerEl);
      _startTimer();
      _show(roomBadgeEl);
      _updateText(roomCodeEl, sigState.roomId || '------');
      _show(callMetaEl);
      
      _hide(actionIdleEl);
      _show(actionActiveEl);
      _hide(actionIncomingEl);

      // Очищаем таймаут ожидания при успешном соединении
      if (callingTimeoutId) {
        clearTimeout(callingTimeoutId);
        callingTimeoutId = null;
      }

      // Проигрываем звук подключения
      playConnectTone();
      break;

    case 'incoming':
      _updateText(callStatusEl, 'Входящий вызов...');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _updateText(roomCodeEl, sigState.roomId || '------');
      _hide(callMetaEl);
      
      _hide(actionIdleEl);
      _hide(actionActiveEl);
      _show(actionIncomingEl);
      
      _startVibration();
      playRingtone();

      _showNotification('Входящий вызов 📞', `${currentCallPeerName || 'Кто-то'} звонит! Откройте приложение, чтобы ответить.`);
      break;

    case 'failed':
      _updateText(callStatusEl, 'Ошибка связи');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _hide(callMetaEl);
      _show(actionActiveEl);
      _addSignalLog('❌ Соединение не удалось установить или оборвалось.');

      playDisconnectTone();
      break;

    case 'timeout':
      _updateText(callStatusEl, 'Лимит ожидания');
      _hide(callTimerEl);
      _show(roomBadgeEl);
      _show(actionActiveEl);
      _addSignalLog('⏳ Превышено время ожидания ответа.');

      playDisconnectTone();
      break;

    case 'permission-denied':
      _updateText(callStatusEl, 'Нет микрофона');
      _hide(callTimerEl);
      _hide(roomBadgeEl);
      _show(actionActiveEl);
      _addSignalLog('⚠️ Ошибка: запрещен доступ к микрофону.');

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
    _handleCloseQuickRoomClick();
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
    btnMuteEl.textContent = '🎙️';
    _addSignalLog('🔇 Ваш микрофон отключен');
  } else {
    btnMuteEl.classList.remove('muted');
    btnMuteEl.textContent = '🔇';
    _addSignalLog('🎤 Ваш микрофон включен');
  }
}

let isSpeakerActive = false;
function _handleSpeakerClick() {
  isSpeakerActive = !isSpeakerActive;
  if (isSpeakerActive) {
    btnSpeakerEl.classList.add('active');
    btnSpeakerEl.textContent = '🔊';
    _addSignalLog('🔊 Громкая связь включена');
  } else {
    btnSpeakerEl.classList.remove('active');
    btnSpeakerEl.textContent = '🔕';
    _addSignalLog('🔕 Громкая связь выключена');
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

// ===================================
// Вкладки и мобильные переключатели
// ===================================

let currentTab = 'chats';
function _switchToTab(tab) {
  currentTab = tab;
  
  const tabIds = ['tab-chats', 'tab-history', 'tab-settings'];
  tabIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === `tab-${tab}`) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });

  const screenIds = ['screen-chats', 'screen-history', 'screen-settings'];
  screenIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === `screen-${tab}`) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  if (tab === 'settings') {
    // Автоматически запрашиваем список микрофонов при открытии настроек
    _loadMicsOnly();
  } else if (tab === 'history') {
    _renderHistory();
  }
}

function _handleOpenQuickRoomClick() {
  if (manualJoinModalEl) {
    manualJoinModalEl.classList.remove('hidden');
  }
}

function _handleCloseQuickRoomClick() {
  if (manualJoinModalEl) {
    manualJoinModalEl.classList.add('hidden');
  }
}

// Загрузка только микрофонов, без переключения табов (внутренняя вспомогательная функция)
async function _loadMicsOnly() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');

    if (selectMicEl) {
      const savedMic = localStorage.getItem('zvonilka_microphone_id') || '';
      selectMicEl.innerHTML = audioInputs.map(device => {
        const selected = device.deviceId === savedMic ? 'selected' : '';
        return `<option value="${device.deviceId}" ${selected}>${device.label || 'Микрофон ' + device.deviceId.slice(0, 4)}</option>`;
      }).join('');
      selectMicEl.insertAdjacentHTML('afterbegin', `<option value="" ${savedMic === '' ? 'selected' : ''}>По умолчанию</option>`);
    }
  } catch (err) {
    log('UI', `⚠️ Не удалось получить список устройств: ${err.message}`);
  }
}

// ============================
// Настройки (Settings Logic)
// ============================

let isMicTesting = false;
let micTestingStream = null;
let micTestingAudioCtx = null;
let micTestingAnalyser = null;
let micTestingRaf = null;

/**
 * Открывает вкладку настроек и запрашивает список микрофонов.
 * @private
 */
async function _handleOpenSettingsClick() {
  _switchToTab('settings');
  
  // Запрашиваем устройства
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');

    if (selectMicEl) {
      const savedMic = localStorage.getItem('zvonilka_microphone_id') || '';
      
      selectMicEl.innerHTML = audioInputs.map(device => {
        const selected = device.deviceId === savedMic ? 'selected' : '';
        return `<option value="${device.deviceId}" ${selected}>${device.label || 'Микрофон ' + device.deviceId.slice(0, 4)}</option>`;
      }).join('');
      
      // Добавляем опцию "По умолчанию"
      selectMicEl.insertAdjacentHTML('afterbegin', `<option value="" ${savedMic === '' ? 'selected' : ''}>По умолчанию</option>`);
    }
  } catch (err) {
    log('UI', `⚠️ Не удалось получить список устройств: ${err.message}`);
  }
}

/**
 * Закрывает окно настроек и сбрасывает тест микрофона.
 * @private
 */
function _handleCloseSettingsClick() {
  _stopMicTesting();
}

/**
 * Сохраняет настройки и возвращает к списку чатов.
 * @private
 */
async function _handleSaveSettingsClick() {
  if (selectMicEl) {
    const selectedMic = selectMicEl.value;
    localStorage.setItem('zvonilka_microphone_id', selectedMic);
    setMicrophoneId(selectedMic); // Задаем в WebRTC
  }

  if (rangeVolumeEl) {
    const volume = parseFloat(rangeVolumeEl.value);
    localStorage.setItem('zvonilka_ringtone_volume', String(volume));
    setRingtoneVolume(volume);
  }

  if (inputEditNicknameEl) {
    const newNickname = inputEditNicknameEl.value.trim();
    const profile = getLocalProfile();
    if (profile && newNickname && newNickname !== profile.nickname) {
      try {
        const updated = await updateLocalNickname(newNickname);
        if (myNicknameEl) myNicknameEl.textContent = updated.nickname;
        _addSignalLog('⚙️ Имя профиля успешно обновлено.');
      } catch (err) {
        log('UI', `⚠️ Не удалось обновить никнейм: ${err.message}`);
        alert(`Ошибка обновления имени: ${err.message}`);
      }
    }
  }

  log('UI', '✅ Настройки успешно сохранены.');
  _handleCloseSettingsClick();
  _switchToTab('chats');
}

/**
 * Запускает или останавливает индикацию громкости микрофона в настройках.
 * @private
 */
async function _handleTestMicClick() {
  if (isMicTesting) {
    _stopMicTesting();
    return;
  }

  try {
    const deviceId = selectMicEl ? selectMicEl.value : '';
    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    };

    micTestingStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Web Audio API анализатор
    micTestingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = micTestingAudioCtx.createMediaStreamSource(micTestingStream);
    micTestingAnalyser = micTestingAudioCtx.createAnalyser();
    micTestingAnalyser.fftSize = 256;
    
    source.connect(micTestingAnalyser);
    
    isMicTesting = true;
    if (btnTestMicEl) {
      btnTestMicEl.textContent = 'Остановить';
      btnTestMicEl.classList.add('btn-action--danger');
    }

    const dataArray = new Uint8Array(micTestingAnalyser.frequencyBinCount);
    
    const updateMeter = () => {
      if (!isMicTesting || !micTestingAnalyser) return;
      
      micTestingAnalyser.getByteFrequencyData(dataArray);
      
      // Считаем среднюю громкость
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      
      // Переводим в проценты шкалы
      const percent = Math.min(100, Math.round((average / 128) * 100));
      
      if (micMeterBarEl) {
        micMeterBarEl.style.width = `${percent}%`;
      }
      
      micTestingRaf = requestAnimationFrame(updateMeter);
    };

    updateMeter();
    log('UI', '🎤 Запущен тест микрофона.');

  } catch (err) {
    log('UI', `❌ Не удалось протестировать микрофон: ${err.message}`);
    _stopMicTesting();
  }
}

/**
 * Останавливает тест микрофона.
 * @private
 */
function _stopMicTesting() {
  isMicTesting = false;
  
  if (micTestingRaf) {
    cancelAnimationFrame(micTestingRaf);
    micTestingRaf = null;
  }
  
  if (micTestingStream) {
    micTestingStream.getTracks().forEach(track => track.stop());
    micTestingStream = null;
  }
  
  if (micTestingAudioCtx) {
    micTestingAudioCtx.close();
    micTestingAudioCtx = null;
  }
  
  micTestingAnalyser = null;

  if (btnTestMicEl) {
    btnTestMicEl.textContent = 'Проверить';
    btnTestMicEl.classList.remove('btn-action--danger');
  }

  if (micMeterBarEl) {
    micMeterBarEl.style.width = '0%';
  }
  log('UI', '🎤 Тест микрофона остановлен.');
}

// ============================
// Индикаторы качества связи и статуса партнера
// ============================

/**
 * Изменение качества WebRTC соединения.
 * @private
 * @param {object} quality
 */
function _handleQualityChange(quality) {
  if (!connQualityEl) return;
  
  let icon = '📶';
  let text = 'Ожидание';
  let color = 'var(--text-muted)';

  if (quality.status === 'excellent') {
    icon = '🟢';
    text = 'Отлично';
    color = 'var(--color-success)';
  } else if (quality.status === 'fair') {
    icon = '🟡';
    text = 'Средне';
    color = 'var(--color-accent)';
  } else if (quality.status === 'poor') {
    icon = '🔴';
    text = 'Плохо';
    color = 'var(--color-danger)';
  }

  connQualityEl.innerHTML = `${icon} ${text} (${Math.round(quality.rtt)}мс)`;
  connQualityEl.style.color = color;
  connQualityEl.style.borderColor = color;
}

/**
 * Изменение присутствия пира в комнате.
 * @private
 * @param {boolean} isOnline
 */
function _handlePeerPresenceChange(isOnline) {
  if (!peerStatusEl) return;

  if (isOnline) {
    peerStatusEl.classList.add('online');
    peerStatusEl.textContent = '● В сети';
    _addSignalLog('🟢 Собеседник вошел в комнату (в сети).');
  } else {
    peerStatusEl.classList.remove('online');
    peerStatusEl.textContent = '● Не в сети';
    _addSignalLog('⚪ Собеседник покинул комнату (не в сети).');
  }
}

// ============================
// Браузерные Push-уведомления
// ============================

/**
 * Запрашивает права на отправку уведомлений и показывает его.
 * @private
 * @param {string} title
 * @param {string} body
 */
function _showNotification(title, body) {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: 'assets/icons/icon-192.png'
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, {
          body,
          icon: 'assets/icons/icon-192.png'
        });
      }
    });
  }
}

// ===================================
// Профиль и список друзей (Добавление/Звонки)
// ===================================

/**
 * Инициализация при первой загрузке профиля.
 * @private
 */
function _onProfileLoaded(profile) {
  if (myNicknameEl) myNicknameEl.textContent = profile.nickname;
  if (myCodeEl) myCodeEl.textContent = profile.user_code;
  if (inputEditNicknameEl) inputEditNicknameEl.value = profile.nickname;

  // Инициализируем личный WebSocket-канал для входящих звонков
  initPersonalChannel(
    profile.id,
    (invite) => _handleIncomingInvite(invite),
    (response) => _handleInviteResponse(response)
  );

  // Инициализируем глобальное присутствие
  initPresence(profile, (presenceState) => {
    _handlePresenceSync(presenceState);
  });

  // Загружаем список друзей и подписываемся на его изменения
  _updateFriendsList();
  subscribeToFriends(() => {
    _updateFriendsList();
  });
}

/**
 * Рендерит и обновляет список друзей.
 * @private
 */
async function _updateFriendsList() {
  if (!friendsListEl) return;

  try {
    const friends = await loadFriends();
    
    // Получаем элемент горизонтальной ленты онлайн-контактов
    const ribbonEl = document.getElementById('online-ribbon');
    if (ribbonEl) {
      // Сохраняем кнопку быстрого входа
      const quickActionBtn = document.getElementById('btn-quick-room');
      ribbonEl.innerHTML = '';
      if (quickActionBtn) {
        ribbonEl.appendChild(quickActionBtn);
      }
    }

    if (!friends || friends.length === 0) {
      friendsListEl.innerHTML = '<div class="friends-empty">Список друзей пуст. Добавьте друга по его коду выше!</div>';
      return;
    }

    friendsListEl.innerHTML = '';
    
    // Получаем список онлайн-пользователей из присутствия
    const onlineIds = window.__onlineUsers || new Set();

    friends.forEach(friend => {
      const isOnline = onlineIds.has(friend.id);
      const presenceClass = isOnline ? 'online' : '';
      const presenceText = isOnline ? 'В сети' : 'Не в сети';

      // 1. Добавляем в горизонтальную ленту, если друг в сети
      if (isOnline && ribbonEl) {
        const firstLetter = friend.nickname ? friend.nickname.charAt(0).toUpperCase() : '👤';
        const ribbonItem = document.createElement('div');
        ribbonItem.className = 'ribbon-item';
        ribbonItem.innerHTML = `
          <div class="ribbon-avatar-wrap">
            <span class="ribbon-avatar">${firstLetter}</span>
            <div class="presence-dot online"></div>
          </div>
          <span class="ribbon-name">${friend.nickname}</span>
        `;
        ribbonItem.addEventListener('click', () => {
          _initiateDirectCall(friend.id, friend.nickname);
        });
        ribbonEl.appendChild(ribbonItem);
      }

      // 2. Рендерим в вертикальный список всех друзей
      const friendItem = document.createElement('div');
      friendItem.className = 'friend-item';
      friendItem.innerHTML = `
        <div class="friend-info">
          <div class="presence-dot ${presenceClass}" title="${presenceText}"></div>
          <span class="friend-name">${friend.nickname}</span>
        </div>
        <div class="friend-actions">
          <button class="btn-friend-call" title="Позвонить">📞</button>
          <button class="btn-friend-delete" title="Удалить">🗑️</button>
        </div>
      `;

      // Привязываем события
      friendItem.querySelector('.btn-friend-call').addEventListener('click', (e) => {
        e.stopPropagation();
        _initiateDirectCall(friend.id, friend.nickname);
      });

      friendItem.querySelector('.btn-friend-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        _deleteFriend(friend.id, friend.nickname);
      });

      // При клике на самого друга сразу запускаем прямой вызов
      friendItem.addEventListener('click', () => {
        _initiateDirectCall(friend.id, friend.nickname);
      });

      friendsListEl.appendChild(friendItem);
    });
  } catch (err) {
    log('UI', `⚠️ Ошибка рендеринга списка друзей: ${err.message}`);
    friendsListEl.innerHTML = '<div class="error-msg">Ошибка загрузки списка друзей</div>';
  }
}

/**
 * Обработчик создания нового профиля при онбординге.
 * @private
 */
async function _handleSaveOnboardClick() {
  if (!inputOnboardNicknameEl || !btnSaveOnboardEl) return;

  const nickname = inputOnboardNicknameEl.value.trim();
  if (!nickname) {
    if (onboardErrorEl) {
      onboardErrorEl.textContent = 'Имя не должно быть пустым!';
      onboardErrorEl.classList.remove('hidden');
    }
    return;
  }

  btnSaveOnboardEl.disabled = true;
  btnSaveOnboardEl.textContent = 'Создание...';

  try {
    const profile = await createProfile(nickname);
    if (onboardErrorEl) onboardErrorEl.classList.add('hidden');
    if (onboardingModalEl) onboardingModalEl.classList.add('hidden');
    
    _onProfileLoaded(profile);
  } catch (err) {
    log('UI', `❌ Ошибка создания профиля: ${err.message}`);
    if (onboardErrorEl) {
      onboardErrorEl.textContent = `Ошибка: ${err.message}`;
      onboardErrorEl.classList.remove('hidden');
    }
  } finally {
    btnSaveOnboardEl.disabled = false;
    btnSaveOnboardEl.textContent = 'Создать профиль';
  }
}

/**
 * Копирование кода пользователя.
 * @private
 */
function _handleCopyMyCodeClick() {
  const profile = getLocalProfile();
  if (profile && profile.user_code) {
    navigator.clipboard.writeText(profile.user_code)
      .then(() => {
        _addSignalLog('📋 Ваш код друга скопирован в буфер');
        if (btnCopyMyCodeEl) {
          btnCopyMyCodeEl.style.transform = 'scale(1.3)';
          setTimeout(() => btnCopyMyCodeEl.style.transform = '', 200);
        }
      })
      .catch(err => log('UI', `Не удалось скопировать: ${err.message}`));
  }
}

/**
 * Добавление друга по 6-значному коду.
 * @private
 */
async function _handleFriendAddClick() {
  if (!inputFriendCodeEl || !btnAddFriendEl) return;

  const code = inputFriendCodeEl.value.trim();
  if (!code || code.length !== 6) {
    if (addFriendErrorEl) {
      addFriendErrorEl.textContent = 'Введите корректный 6-значный код.';
      addFriendErrorEl.classList.remove('hidden');
    }
    return;
  }

  btnAddFriendEl.disabled = true;
  btnAddFriendEl.textContent = '⏳';

  try {
    await addFriendByCode(code);
    inputFriendCodeEl.value = '';
    if (addFriendErrorEl) addFriendErrorEl.classList.add('hidden');
    _addSignalLog('✅ Друг успешно добавлен!');
    _updateFriendsList();
  } catch (err) {
    log('UI', `⚠️ Ошибка добавления друга: ${err.message}`);
    if (addFriendErrorEl) {
      addFriendErrorEl.textContent = err.message;
      addFriendErrorEl.classList.remove('hidden');
    }
  } finally {
    btnAddFriendEl.disabled = false;
    btnAddFriendEl.textContent = '+';
  }
}

/**
 * Удаление друга.
 * @private
 */
async function _deleteFriend(friendId, friendNickname) {
  if (confirm(`Вы уверены, что хотите удалить друга "${friendNickname}"?`)) {
    try {
      await removeFriend(friendId);
      _addSignalLog(`🗑️ Друг ${friendNickname} удален.`);
      _updateFriendsList();
    } catch (err) {
      log('UI', `❌ Не удалось удалить друга: ${err.message}`);
      alert(`Ошибка удаления: ${err.message}`);
    }
  }
}

/**
 * Инициация прямого вызова через broadcast.
 * @private
 */
async function _initiateDirectCall(friendId, friendNickname) {
  if (getSignalingState().role) {
    alert('Вы уже участвуете в вызове или ожидании!');
    return;
  }

  currentCallPeerName = friendNickname;
  _addSignalLog(`📞 Вызов друга: ${friendNickname}...`);
  
  _transitionToState('connecting');

  try {
    const roomId = await createRoom();
    await startCall(roomId);

    // Отправляем вызов через Supabase Broadcast
    await sendCallInvite(friendId, roomId, getLocalProfile());

    // Устанавливаем лимит ожидания 25 секунд
    callingTimeoutId = setTimeout(() => {
      _addSignalLog('⏳ Собеседник не отвечает.');
      _transitionToState('timeout');
      hangUp(true);
    }, 25000);

  } catch (err) {
    log('UI', `❌ Ошибка инициации прямого вызова: ${err.message}`);
    _transitionToState('failed');
    hangUp(true);
  }
}

/**
 * Входящий звонок от друга (Supabase Broadcast).
 * @private
 */
function _handleIncomingInvite(invite) {
  const sigState = getSignalingState();
  const myProfile = getLocalProfile();

  // Если уже разговариваем или звоним сами
  if (sigState.role || isCallActive) {
    log('UI', `⚠️ Занят: отклоняем вызов от ${invite.callerName}`);
    sendCallResponse(invite.callerId, 'busy', myProfile.id);
    return;
  }

  currentCallPeerName = invite.callerName;
  incomingCallRoomId = invite.roomId;
  incomingCallCallerId = invite.callerId;

  log('UI', `📞 Входящий вызов от ${invite.callerName}`);
  _transitionToState('incoming');
}

/**
 * Ответ друга на наш исходящий звонок (Supabase Broadcast).
 * @private
 */
function _handleInviteResponse(response) {
  const sigState = getSignalingState();
  
  // Реагируем только если мы в состоянии вызова (caller)
  if (sigState.role !== 'caller') return;

  if (callingTimeoutId) {
    clearTimeout(callingTimeoutId);
    callingTimeoutId = null;
  }

  if (response.type === 'decline') {
    _addSignalLog('📴 Собеседник отклонил вызов.');
    _updateText(callStatusEl, 'Отклонено');
    playDisconnectTone();
    setTimeout(() => {
      _transitionToState('closed');
      hangUp(true);
    }, 2000);
  } else if (response.type === 'busy') {
    _addSignalLog('📴 Собеседник занят.');
    _updateText(callStatusEl, 'Линия занята');
    playDisconnectTone();
    setTimeout(() => {
      _transitionToState('closed');
      hangUp(true);
    }, 2000);
  }
}

/**
 * Обновление статусов присутствия друзей.
 * @private
 */
function _handlePresenceSync(presenceState) {
  const onlineIds = new Set();
  
  Object.keys(presenceState).forEach(key => {
    const list = presenceState[key];
    if (list && list.length > 0) {
      const payload = list[0]; // { user_id, nickname }
      if (payload && payload.user_id) {
        onlineIds.add(payload.user_id);
      }
    }
  });

  // Записываем в глобальную переменную для рендерера списка друзей
  window.__onlineUsers = onlineIds;
  
  // Обновляем отображение списка друзей без перезагрузки всей базы данных
  const items = document.querySelectorAll('.friend-item');
  items.forEach(item => {
    const nameEl = item.querySelector('.friend-name');
    if (!nameEl) return;
    
    // Ищем соответствующего друга по имени среди друзей
    loadFriends().then(friends => {
      if (!friends) return;
      const friend = friends.find(f => f.nickname === nameEl.textContent);
      if (friend) {
        const dot = item.querySelector('.presence-dot');
        if (dot) {
          const isOnline = onlineIds.has(friend.id);
          if (isOnline) {
            dot.className = 'presence-dot online';
            dot.title = 'В сети';
          } else {
            dot.className = 'presence-dot';
            dot.title = 'Не в сети';
          }
        }
      }
    });
  });
}


