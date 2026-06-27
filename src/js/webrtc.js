/**
 * webrtc.js — Модуль WebRTC
 * Управление PeerConnection, медиа-потоками и ICE-кандидатами.
 *
 * Отвечает за:
 * - Запрос доступа к микрофону
 * - Создание и настройку RTCPeerConnection с ICE-серверами
 * - Добавление локальных медиа-треков
 * - Логику генерации offer/answer и обмен ими через сигналинг
 * - Обработку ICE-кандидатов в обе стороны
 * - Воспроизведение удалённого аудио
 * - Мониторинг состояний соединения и таймауты
 */

import { ICE_SERVERS, CONNECTION_TIMEOUT_MS } from './config.js';
import { sendSignal, onSignal, cleanup as signalingCleanup, getState as getSignalingState } from './signaling.js';
import { log } from './utils.js';

// === Внутреннее состояние модуля ===

/** @type {RTCPeerConnection | null} */
let peerConnection = null;

/** @type {MediaStream | null} */
let localStream = null;

/** @type {object | null} Пакет входящего предложения */
let pendingOffer = null;

/** @type {HTMLAudioElement | null} */
let remoteAudioElement = null;

/** @type {number | null} */
let connectionTimeoutTimer = null;

/** @type {Array<function>} Подписчики на изменение статуса соединения WebRTC */
const stateListeners = [];

/** @type {function} Отписка от сигналинга */
let unsubscribeSignaling = null;

// ============================
// 1. Инициализация
// ============================

/**
 * Инициализирует модуль WebRTC.
 */
export function initWebRTC() {
  log('WebRTC', '✅ Модуль инициализирован.');
}

// ============================
// 2. Установка слушателей статуса
// ============================

/**
 * Подписка на изменения состояния WebRTC соединения.
 * @param {function(string): void} callback - вызовется со статусом соединения (например, 'connecting', 'connected', 'disconnected', 'failed')
 * @returns {function} функция отписки
 */
export function onConnectionStateChange(callback) {
  if (typeof callback !== 'function') return () => {};
  stateListeners.push(callback);
  return () => {
    const idx = stateListeners.indexOf(callback);
    if (idx !== -1) stateListeners.splice(idx, 1);
  };
}

/**
 * Оповещает всех слушателей об изменении состояния.
 * @private
 * @param {string} state
 */
function _notifyStateChange(state) {
  log('WebRTC', `🔄 Статус соединения изменился: ${state}`);
  for (const listener of stateListeners) {
    try {
      listener(state);
    } catch (err) {
      log('WebRTC', `❌ Ошибка в слушателе статуса: ${err.message}`);
    }
  }
}

// ============================
// 3. Запрос медиа-устройств (Микрофон)
// ============================

/**
 * Запрашивает доступ к микрофону пользователя.
 * @private
 * @returns {Promise<MediaStream>}
 */
async function _acquireMicrophone() {
  if (localStream) {
    log('WebRTC', 'Микрофон уже захвачен.');
    return localStream;
  }

  log('WebRTC', '🎤 Запрос доступа к микрофону...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    log('WebRTC', '✅ Доступ к микрофону получен.');
    return localStream;
  } catch (err) {
    log('WebRTC', `❌ Ошибка доступа к микрофону: ${err.message}`);
    _notifyStateChange('permission-denied');
    throw err;
  }
}

// ============================
// 4. Создание Peer Connection
// ============================

/**
 * Создаёт и настраивает RTCPeerConnection.
 * @private
 * @param {MediaStream} stream
 */
function _createPeerConnection(stream) {
  log('WebRTC', '⚙️ Создание RTCPeerConnection...');
  
  peerConnection = new RTCPeerConnection({
    iceServers: ICE_SERVERS
  });

  // Добавление локальных треков
  stream.getTracks().forEach(track => {
    peerConnection.addTrack(track, stream);
    log('WebRTC', `  ↳ Добавлен локальный трек: ${track.kind}`);
  });

  // Обработка ICE-кандидатов от браузера
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      log('WebRTC', '📤 Найден локальный ICE-кандидат, отправляем...');
      sendSignal('ice-candidate', event.candidate.toJSON()).catch(err => {
        log('WebRTC', `❌ Не удалось отправить ICE-кандидат: ${err.message}`);
      });
    } else {
      log('WebRTC', '🏁 Сбор локальных ICE-кандидатов завершен.');
    }
  };

  // Обработка входящего удаленного трека
  peerConnection.ontrack = (event) => {
    log('WebRTC', '📥 Получен удаленный медиа-трек.');
    const remoteStream = event.streams[0];
    
    if (!remoteAudioElement) {
      remoteAudioElement = new Audio();
    }
    
    remoteAudioElement.srcObject = remoteStream;
    remoteAudioElement.play()
      .then(() => log('WebRTC', '🔊 Воспроизведение удалённого звука запущено.'))
      .catch(err => log('WebRTC', `⚠️ Ошибка автовоспроизведения звука: ${err.message}`));
  };

  // Мониторинг изменения состояния подключения
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    _notifyStateChange(state);

    if (state === 'connected') {
      _clearConnectionTimeout();
    } else if (state === 'failed' || state === 'closed') {
      _clearConnectionTimeout();
      // Автоматический сброс при сбое
      hangUp().catch(err => log('WebRTC', `Ошибка при автосбросе: ${err.message}`));
    }
  };

  // Вспомогательный слушатель для отслеживания старых браузеров
  peerConnection.oniceconnectionstatechange = () => {
    log('WebRTC', `❄️ ICE Connection State: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      _notifyStateChange('failed');
      hangUp().catch(err => log('WebRTC', `Ошибка при автосбросе: ${err.message}`));
    }
  };
}

// ============================
// 5. Логика звонка (Caller)
// ============================

/**
 * Инициализирует звонок (для вызывающего).
 * 1. Получает доступ к микрофону
 * 2. Создаёт PeerConnection
 * 3. Создаёт offer
 * 4. Запускает прослушивание ответов и ICE
 * 5. Устанавливает таймаут соединения
 */
export async function startCall() {
  _notifyStateChange('connecting');
  
  try {
    const stream = await _acquireMicrophone();
    _createPeerConnection(stream);

    // Установка таймаута на соединение
    _startConnectionTimeout();

    // Создание предложения (offer)
    log('WebRTC', 'Создание SDP Offer...');
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false
    });
    
    await peerConnection.setLocalDescription(offer);
    log('WebRTC', '✅ Установлен Local Description (Offer).');

    // Отправка offer через сигналинг
    await sendSignal('offer', { sdp: offer.sdp });

    // Подписка на сигналы от callee
    _subscribeToSignalingEvents();

  } catch (err) {
    log('WebRTC', `❌ Не удалось совершить звонок: ${err.message}`);
    await hangUp();
    throw err;
  }
}

// ============================
// 6. Логика ответа (Callee)
// ============================

/**
 * Подготавливает соединение и отвечает на звонок (для вызываемого).
 * 1. Получает доступ к микрофону
 * 2. Создаёт PeerConnection
 * 3. Подписывается на сигналы от caller
 */
export async function prepareToReceiveCall() {
  // Вызывается интерфейсом заранее или при входе в комнату
  _subscribeToSignalingEvents();
}

/**
 * Отвечает на входящий вызов (посылает Answer).
 * @param {object|null} offerPayload - SDP входящего предложения (если null, используется сохраненный pendingOffer)
 */
export async function acceptIncomingCall(offerPayload = null) {
  _notifyStateChange('connecting');

  const payload = offerPayload || pendingOffer;
  if (!payload) {
    log('WebRTC', '❌ Ошибка: нет входящего предложения для ответа.');
    _notifyStateChange('failed');
    return;
  }

  try {
    const stream = await _acquireMicrophone();
    _createPeerConnection(stream);
    _startConnectionTimeout();

    // Установка удаленного описания (Offer)
    const sessionDescription = new RTCSessionDescription({
      type: 'offer',
      sdp: payload.sdp
    });
    
    await peerConnection.setRemoteDescription(sessionDescription);
    log('WebRTC', '✅ Установлен Remote Description (Offer).');

    // Создание ответа (Answer)
    log('WebRTC', 'Создание SDP Answer...');
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    log('WebRTC', '✅ Установлен Local Description (Answer).');

    // Отправка answer через сигналинг
    await sendSignal('answer', { sdp: answer.sdp });

  } catch (err) {
    log('WebRTC', `❌ Не удалось ответить на звонок: ${err.message}`);
    await hangUp();
    throw err;
  }
}

// ============================
// 7. Подписка на события сигналинга
// ============================

/**
 * Слушает входящие сигналы и передает их в PeerConnection.
 * @private
 */
function _subscribeToSignalingEvents() {
  if (unsubscribeSignaling) return;

  unsubscribeSignaling = onSignal(async (signal) => {
    const { role } = getSignalingState();

    try {
      if (signal.type === 'offer' && role === 'callee') {
        // Получили предложение от звонящего
        log('WebRTC', '📥 Получен offer от caller. Сохраняем и переключаем в статус incoming...');
        pendingOffer = signal.payload;
        _notifyStateChange('incoming');
      } 
      else if (signal.type === 'answer' && role === 'caller') {
        // Получили ответ от принимающего
        log('WebRTC', '📥 Получен answer от callee. Применяем...');
        const sessionDescription = new RTCSessionDescription({
          type: 'answer',
          sdp: signal.payload.sdp
        });
        await peerConnection.setRemoteDescription(sessionDescription);
        log('WebRTC', '✅ Установлен Remote Description (Answer).');
      } 
      else if (signal.type === 'ice-candidate') {
        // Получили ICE-кандидат
        if (peerConnection && peerConnection.remoteDescription) {
          log('WebRTC', '📥 Получен и добавлен удаленный ICE-кандидат.');
          await peerConnection.addIceCandidate(new RTCIceCandidate(signal.payload));
        } else {
          log('WebRTC', '⚠️ Получен ICE-кандидат, но Remote Description еще не установлен. Пропускаем.');
        }
      }
      else if (signal.type === 'hangup') {
        log('WebRTC', '📥 Получен сигнал сброса звонка от удаленного пира.');
        await hangUp(false); // Сбрасываем без отправки сигнала сброса повторно
      }
    } catch (err) {
      log('WebRTC', `❌ Ошибка обработки сигнала: ${err.message}`);
    }
  });
}

// ============================
// 8. Завершение звонка (HangUp)
// ============================

/**
 * Завершает звонок, очищает ресурсы, PeerConnection, стримы.
 * @param {boolean} sendHangupSignal - нужно ли отправлять сигнал 'hangup' противоположной стороне
 */
export async function hangUp(sendHangupSignal = true) {
  log('WebRTC', '📴 Завершение звонка...');
  _clearConnectionTimeout();
  pendingOffer = null;

  // 1. Отправить сигнал hangup удаленному пиру, если требуется
  if (sendHangupSignal && getSignalingState().isConnected) {
    try {
      await sendSignal('hangup', { reason: 'user_ended' });
    } catch (err) {
      log('WebRTC', `⚠️ Не удалось отправить сигнал hangup: ${err.message}`);
    }
  }

  // 2. Отписаться от сигналинга
  if (unsubscribeSignaling) {
    unsubscribeSignaling();
    unsubscribeSignaling = null;
  }

  // 3. Закрыть PeerConnection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    log('WebRTC', '  ↳ RTCPeerConnection закрыт.');
  }

  // 4. Остановить микрофонные треки
  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
      log('WebRTC', `  ↳ Трек остановлен: ${track.kind}`);
    });
    localStream = null;
  }

  // 5. Остановить воспроизведение удаленного звука
  if (remoteAudioElement) {
    remoteAudioElement.srcObject = null;
    remoteAudioElement = null;
  }

  // 6. Очистить сессию сигналинга
  await signalingCleanup();

  _notifyStateChange('closed');
  log('WebRTC', '✅ Звонок завершен и ресурсы очищены.');
}

// ============================
// 9. Вспомогательные функции таймаута
// ============================

/**
 * Запускает таймер ожидания установления соединения.
 * @private
 */
function _startConnectionTimeout() {
  _clearConnectionTimeout();
  connectionTimeoutTimer = setTimeout(() => {
    if (peerConnection && peerConnection.connectionState !== 'connected') {
      log('WebRTC', '⏳ Превышено время ожидания соединения (таймаут).');
      _notifyStateChange('timeout');
      hangUp().catch(err => log('WebRTC', `Ошибка при таймауте: ${err.message}`));
    }
  }, CONNECTION_TIMEOUT_MS);
}

/**
 * Сбрасывает таймер ожидания.
 * @private
 */
function _clearConnectionTimeout() {
  if (connectionTimeoutTimer) {
    clearTimeout(connectionTimeoutTimer);
    connectionTimeoutTimer = null;
  }
}
