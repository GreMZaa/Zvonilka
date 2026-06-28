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
import { sendSignal, onSignal, cleanup as signalingCleanup, getState as getSignalingState, logErrorToSupabase } from './signaling.js';
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

/** @type {Array<object>} Очередь удаленных ICE-кандидатов до установки Remote Description */
let pendingRemoteCandidates = [];

/** @type {number | null} */
let connectionTimeoutTimer = null;

/** @type {number | null} Интервал мониторинга статистики */
let statsInterval = null;

/** @type {string | null} Выбранный ID микрофона */
let selectedMicrophoneId = null;

/** @type {boolean} Принудительное использование TURN-реле (relay) */
let forceRelay = false;

/** @type {Array<function>} Подписчики на изменение статуса соединения WebRTC */
const stateListeners = [];

/** @type {Array<function>} Подписчики на изменение качества соединения WebRTC */
const qualityListeners = [];

/** @type {function} Отписка от сигналинга */
let unsubscribeSignaling = null;

/** @type {MediaRecorder | null} Регистратор резервного аудиоканала */
let fallbackMediaRecorder = null;

/** @type {boolean} Активен ли резервный аудиоканал */
let isFallbackActive = false;

/** @type {number | null} Таймер переключения на резервный канал */
let fallbackTimeoutTimer = null;

/**
 * Подписка на изменение качества WebRTC соединения.
 * @param {function({ status: 'excellent' | 'fair' | 'poor', rtt: number, packetLoss: number }): void} callback
 * @returns {function} функция отписки
 */
export function onQualityChange(callback) {
  if (typeof callback !== 'function') return () => {};
  qualityListeners.push(callback);
  return () => {
    const idx = qualityListeners.indexOf(callback);
    if (idx !== -1) qualityListeners.splice(idx, 1);
  };
}

/**
 * Задает выбранный микрофон для будущих вызовов.
 * @param {string} deviceId
 */
export function setMicrophoneId(deviceId) {
  selectedMicrophoneId = deviceId;
  log('WebRTC', `🎤 Задан микрофон: ${deviceId}`);
}


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

  log('WebRTC', `🎤 Запрос доступа к микрофону (${selectedMicrophoneId ? 'ID: ' + selectedMicrophoneId : 'по умолчанию'})...`);
  
  const constraints = {
    audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true,
    video: false
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    log('WebRTC', '✅ Доступ к микрофону получен.');
    return localStream;
  } catch (err) {
    log('WebRTC', `❌ Ошибка доступа к микрофону: ${err.message}`);
    _notifyStateChange('permission-denied');
    
    // Отправляем диагностику на сервер
    logErrorToSupabase('error', `Microphone access denied: ${err.message}`, {
      deviceId: selectedMicrophoneId,
      errorName: err.name
    });
    
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
  log('WebRTC', `⚙️ Создание RTCPeerConnection (Relay-only: ${forceRelay ? 'Да' : 'Нет'})...`);
  
  const config = {
    iceServers: ICE_SERVERS,
    // Если включено принудительное реле, используем только TURN
    iceTransportPolicy: forceRelay ? 'relay' : 'all'
  };

  peerConnection = new RTCPeerConnection(config);

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
      remoteAudioElement = document.getElementById('remote-audio');
    }
    
    if (remoteAudioElement) {
      remoteAudioElement.srcObject = remoteStream;
      
      // Запуск воспроизведения с защитой от ограничений автоплея
      remoteAudioElement.play()
        .then(() => log('WebRTC', '🔊 Воспроизведение удалённого звука запущено.'))
        .catch(err => {
          log('WebRTC', `⚠️ Ошибка автовоспроизведения звука: ${err.message}. Будет запущен при клике.`);
          
          // Резервный запуск при клике на экран
          const playOnDocClick = () => {
            if (remoteAudioElement) {
              remoteAudioElement.play()
                .then(() => {
                  log('WebRTC', '🔊 Звук запущен по взаимодействию пользователя.');
                  document.removeEventListener('click', playOnDocClick);
                })
                .catch(e => log('WebRTC', `⚠️ Резервный запуск не удался: ${e.message}`));
            }
          };
          document.addEventListener('click', playOnDocClick);
        });
    } else {
      log('WebRTC', '❌ Ошибка: Элемент #remote-audio не найден на странице.');
    }
  };

  // Мониторинг изменения состояния подключения
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    _notifyStateChange(state);

    if (state === 'connected') {
      _clearConnectionTimeout();
      if (fallbackTimeoutTimer) {
        clearTimeout(fallbackTimeoutTimer);
        fallbackTimeoutTimer = null;
      }
      _startQualityMonitoring(); // Запуск мониторинга качества
    } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
      _clearConnectionTimeout();
      if (fallbackTimeoutTimer) {
        clearTimeout(fallbackTimeoutTimer);
        fallbackTimeoutTimer = null;
      }
      _stopQualityMonitoring(); // Остановка мониторинга качества
      
      if (state === 'failed') {
        logErrorToSupabase('error', 'WebRTC connection state failed', {
          forceRelay,
          iceConnectionState: peerConnection ? peerConnection.iceConnectionState : 'closed'
        });
        
        // Автоматический сброс при сбое
        hangUp().catch(err => log('WebRTC', `Ошибка при автосбросе: ${err.message}`));
      }
    }
  };

  // Вспомогательный слушатель для отслеживания старых браузеров
  peerConnection.oniceconnectionstatechange = () => {
    if (!peerConnection) return;
    log('WebRTC', `❄️ ICE Connection State: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      _notifyStateChange('failed');
      _stopQualityMonitoring();
      logErrorToSupabase('error', 'ICE connection state failed', { forceRelay });
      hangUp().catch(err => log('WebRTC', `Ошибка при автосбросе: ${err.message}`));
    }
  };
}

// ============================
// 4.1 Мониторинг качества связи
// ============================

/**
 * Запускает сбор статистики WebRTC для индикации качества.
 * @private
 */
function _startQualityMonitoring() {
  _stopQualityMonitoring();
  
  let lastPacketsLost = 0;
  let poorQualitySeconds = 0;

  statsInterval = setInterval(async () => {
    if (!peerConnection) return;
    
    try {
      const stats = await peerConnection.getStats();
      let rtt = 0;
      let jitter = 0;
      let packetsLost = 0;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          packetsLost = report.packetsLost || 0;
          jitter = (report.jitter || 0) * 1000;
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = (report.currentRoundTripTime || 0) * 1000;
        }
      });

      const deltaLost = Math.max(0, packetsLost - lastPacketsLost);
      lastPacketsLost = packetsLost;

      let status = 'excellent';
      if (rtt > 250 || deltaLost > 5 || jitter > 30) {
        status = 'poor';
        poorQualitySeconds += 2;
      } else if (rtt > 100 || deltaLost > 2 || jitter > 15) {
        status = 'fair';
        poorQualitySeconds = 0;
      } else {
        poorQualitySeconds = 0;
      }

      // Оповещаем подписчиков
      qualityListeners.forEach(listener => {
        try {
          listener({ status, rtt, packetLoss: deltaLost, jitter });
        } catch (e) {}
      });

      // Переключаемся на TURN при плохом качестве
      if (poorQualitySeconds >= 10 && !forceRelay) {
        log('WebRTC', '⚠️ Качество связи плохое. Переключаемся на TURN...');
        logErrorToSupabase('warn', 'Forced switch to TURN due to low WebRTC quality', { rtt, deltaLost, jitter });
        _stopQualityMonitoring();
        forceRelay = true;
        _reconnectWithForcedRelay();
      }

    } catch (err) {
      log('WebRTC', `Ошибка сбора статистики: ${err.message}`);
    }
  }, 2000);
}

/**
 * Останавливает мониторинг статистики.
 * @private
 */
function _stopQualityMonitoring() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

/**
 * Пересоздает PeerConnection с флагом принудительного TURN.
 * @private
 */
async function _reconnectWithForcedRelay() {
  log('WebRTC', '🔄 Перезапуск PeerConnection с Relay-only...');
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  const { role } = getSignalingState();
  if (role === 'caller') {
    _createPeerConnection(localStream);
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);
    await sendSignal('offer', { sdp: offer.sdp, forcedRelay: true });
  } else {
    _createPeerConnection(localStream);
  }
}

// ============================
// 4.2 Резервный аудиоканал (Fallback Audio)
// ============================

/**
 * Запускает резервную передачу аудио через Supabase Realtime Broadcast.
 * @private
 */
async function _startFallbackAudio() {
  if (isFallbackActive) return;
  isFallbackActive = true;
  
  log('WebRTC', '📻 Запуск резервного аудиоканала (Supabase Broadcast)...');
  logErrorToSupabase('info', 'Switched to fallback audio channel due to WebRTC block');
  
  // Уведомляем интерфейс, что связь установлена через резервный канал
  _notifyStateChange('connected');

  try {
    const stream = await _acquireMicrophone();
    
    // Инициализируем MediaRecorder. Выбираем поддерживаемый аудиокодек
    let options = { mimeType: 'audio/webm;codecs=opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'audio/mp4' }; // Для iOS Safari
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = {}; // По умолчанию
      }
    }

    fallbackMediaRecorder = new MediaRecorder(stream, options);
    
    fallbackMediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0 && isFallbackActive) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result.split(',')[1];
          // Отправляем чанк через Supabase
          sendSignal('fallback-audio', { data: base64data }).catch(e => {
            log('WebRTC', `⚠️ Ошибка отправки аудио-чанка: ${e.message}`);
          });
        };
        reader.readAsDataURL(event.data);
      }
    };

    // Нарезаем аудио на чанки по 500мс
    fallbackMediaRecorder.start(500);
    log('WebRTC', '📻 Резервный аудиоканал запущен.');

  } catch (err) {
    log('WebRTC', `❌ Ошибка запуска резервного аудио: ${err.message}`);
    isFallbackActive = false;
  }
}

/**
 * Останавливает резервную передачу аудио.
 * @private
 */
function _stopFallbackAudio() {
  isFallbackActive = false;
  
  if (fallbackTimeoutTimer) {
    clearTimeout(fallbackTimeoutTimer);
    fallbackTimeoutTimer = null;
  }

  if (fallbackMediaRecorder) {
    try {
      fallbackMediaRecorder.stop();
    } catch (e) {}
    fallbackMediaRecorder = null;
  }
  log('WebRTC', '📻 Резервный аудиоканал остановлен.');
}

/**
 * Воспроизводит полученный резервный чанк аудио.
 * @private
 * @param {string} base64data
 */
function _playFallbackAudioChunk(base64data) {
  if (!base64data) return;
  
  try {
    const audioUrl = `data:audio/webm;base64,${base64data}`;
    const audio = new Audio(audioUrl);
    const savedVolume = localStorage.getItem('zvonilka_ringtone_volume') || '0.5';
    audio.volume = parseFloat(savedVolume);
    audio.play().catch(err => {
      // Игнорируем автовоспроизведение
    });
  } catch (err) {
    log('WebRTC', `⚠️ Ошибка воспроизведения чанка: ${err.message}`);
  }
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
    fallbackTimeoutTimer = setTimeout(_startFallbackAudio, 15000);

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
  fallbackTimeoutTimer = setTimeout(_startFallbackAudio, 15000);

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

    // Обрабатываем отложенные удаленные ICE-кандидаты
    await _processPendingCandidates();

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
        log('WebRTC', '📥 Получен offer от caller.');
        pendingOffer = signal.payload;
        
        // Проверяем, не является ли этот offer запросом на переподключение через TURN
        if (signal.payload.forcedRelay) {
          log('WebRTC', '🔄 Переподключение через TURN (Relay-only) по запросу от caller...');
          forceRelay = true;
          if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
          }
          // Автоматически отвечаем на пересозданный offer
          await acceptIncomingCall(signal.payload);
        } else {
          // Обычный первый вызов — показываем входящий экран
          _notifyStateChange('incoming');
        }
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

        // Обрабатываем отложенные удаленные ICE-кандидаты
        await _processPendingCandidates();
      } 
      else if (signal.type === 'ice-candidate') {
        // Получили ICE-кандидат
        if (peerConnection && peerConnection.remoteDescription) {
          log('WebRTC', '📥 Получен и добавлен удаленный ICE-кандидат.');
          await peerConnection.addIceCandidate(new RTCIceCandidate(signal.payload));
        } else {
          log('WebRTC', '📥 Получен удаленный ICE-кандидат, откладываем до установки Remote Description.');
          pendingRemoteCandidates.push(signal.payload);
        }
      }
      else if (signal.type === 'fallback-audio') {
        _playFallbackAudioChunk(signal.payload.data);
        if (!isFallbackActive) {
          log('WebRTC', '📻 Собеседник перешел на резервный канал. Переключаемся тоже...');
          _startFallbackAudio();
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
  _stopQualityMonitoring(); // Останавливаем мониторинг качества
  _stopFallbackAudio(); // Останавливаем резервное аудиовещание
  pendingOffer = null;
  pendingRemoteCandidates = [];
  forceRelay = false; // Сбрасываем принудительный TURN для будущих звонков

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

// ============================
// 10. Отключение микрофона (Mute)
// ============================

/**
 * Переключает состояние отключения микрофона.
 * @returns {boolean} true, если микрофон выключен (muted), иначе false
 */
export function toggleMute() {
  if (!localStream) {
    log('WebRTC', '⚠️ Попытка mute, но локальный медиапоток отсутствует.');
    return false;
  }

  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length === 0) {
    log('WebRTC', '⚠️ Аудиодорожки не найдены.');
    return false;
  }

  // Инвертируем состояние включения для всех треков
  const isEnabled = audioTracks[0].enabled;
  audioTracks.forEach(track => {
    track.enabled = !isEnabled;
    log('WebRTC', `🎤 Микрофон ${track.enabled ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
  });

  return !isEnabled; // Возвращаем новое состояние: true = приглушен (muted)
}

/**
 * Разблокирует воспроизведение аудио в Safari на iOS.
 * Проигрывает пустой немой звук на статическом элементе remote-audio, чтобы разблокировать его.
 */
export function unlockAudioContext() {
  let audio = document.getElementById('remote-audio');
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'remote-audio';
    audio.setAttribute('autoplay', '');
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.style.display = 'none';
    document.body.appendChild(audio);
  }
  
  // Задаем пустой беззвучный WAV
  audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  
  audio.play()
    .then(() => {
      log('WebRTC', '🔊 Аудио-элемент remote-audio успешно разблокирован для iOS/Safari.');
    })
    .catch(err => {
      log('WebRTC', `⚠️ Не удалось разблокировать remote-audio: ${err.message}`);
    });
}

/**
 * Добавляет все отложенные удаленные ICE-кандидаты в PeerConnection.
 * Вызывается после успешной установки удаленного описания (Remote Description).
 * @private
 */
async function _processPendingCandidates() {
  if (!peerConnection || !peerConnection.remoteDescription) return;
  if (pendingRemoteCandidates.length === 0) return;

  log('WebRTC', `⚙️ Обработка отложенных удаленных ICE-кандидатов (${pendingRemoteCandidates.length} шт.)...`);
  for (const candidate of pendingRemoteCandidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      log('WebRTC', '  ↳ Отложенный ICE-кандидат успешно добавлен.');
    } catch (err) {
      log('WebRTC', `❌ Ошибка добавления отложенного ICE-кандидата: ${err.message}`);
    }
  }
  pendingRemoteCandidates = [];
}

