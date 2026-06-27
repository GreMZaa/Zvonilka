/**
 * signaling.js — Модуль сигналинга (Supabase Realtime)
 * Обмен данными для установки WebRTC-соединения.
 *
 * Отвечает за:
 * - Подключение к Supabase Realtime
 * - Создание / присоединение к комнате
 * - Отправку и приём offer/answer/ice-candidate
 * - Управление состоянием сигналинга
 * - Очистку при завершении звонка
 *
 * API:
 *   initSignaling()          — инициализация Supabase-клиента
 *   createRoom()             — создать комнату (caller)
 *   joinRoom(roomId)         — присоединиться к комнате (callee)
 *   sendSignal(type, payload)— отправить сигнал (offer/answer/ice-candidate)
 *   onSignal(callback)       — подписаться на входящие сигналы
 *   cleanup()                — отписка и очистка
 *   getState()               — текущее состояние { roomId, role, isConnected }
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, SIGNALING_TABLE } from './config.js';
import { generateId, log } from './utils.js';

// === Внутреннее состояние модуля ===

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabase = null;

/** @type {import('@supabase/supabase-js').RealtimeChannel | null} */
let channel = null;

/** @type {string | null} */
let currentRoomId = null;

/** @type {'caller' | 'callee' | null} */
let currentRole = null;

/** @type {boolean} */
let isConnected = false;

/** @type {Array<function>} Список колбэков для входящих сигналов */
const signalListeners = [];

/** @type {Array<function>} Список колбэков для изменения присутствия собеседника */
const presenceListeners = [];

/**
 * Подписка на изменение онлайн-статуса собеседника.
 * @param {function(boolean): void} callback
 * @returns {function} функция отписки
 */
export function onPeerPresenceChange(callback) {
  if (typeof callback !== 'function') return () => {};
  presenceListeners.push(callback);
  return () => {
    const idx = presenceListeners.indexOf(callback);
    if (idx !== -1) presenceListeners.splice(idx, 1);
  };
}

/**
 * Логирует ошибку или предупреждение в Supabase таблицу diagnostics.
 * @param {'error' | 'warn' | 'info'} level
 * @param {string} message
 * @param {object} details
 */
export async function logErrorToSupabase(level, message, details = {}) {
  if (!supabase) return;
  
  const record = {
    room_id: currentRoomId,
    level,
    message,
    details,
  };

  try {
    const { error } = await supabase.from('diagnostics').insert(record);
    if (error) {
      console.warn('[Diagnostics] Ошибка при отправке удаленного лога:', error.message);
    }
  } catch (err) {
    console.warn('[Diagnostics] Ошибка:', err.message);
  }
}


// ============================
// 1. Инициализация
// ============================

/**
 * Инициализирует Supabase-клиент.
 * Вызывается один раз при старте приложения.
 */
export function initSignaling() {
  if (supabase) {
    log('Signaling', 'Уже инициализирован.');
    return;
  }

  // Supabase SDK загружается через CDN в index.html
  // и доступен как window.supabase
  if (!window.supabase) {
    log('Signaling', '❌ Supabase SDK не найден! Проверьте подключение в index.html.');
    return;
  }

  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  log('Signaling', '✅ Supabase-клиент создан.');
}

// ============================
// 2. Создание комнаты (Caller)
// ============================

/**
 * Создаёт новую комнату и подписывается на обновления.
 * Вызывающий (caller) генерирует roomId и ждёт ответчика.
 *
 * @returns {Promise<string>} roomId — ID созданной комнаты
 */
export async function createRoom() {
  _ensureInitialized();

  // Очистить предыдущую сессию если есть
  if (currentRoomId) {
    await cleanup();
  }

  currentRoomId = generateId();
  currentRole = 'caller';

  log('Signaling', `📞 Комната создана: ${currentRoomId} (роль: caller)`);

  // Подписаться на входящие сигналы
  _subscribeToRoom();

  isConnected = true;
  return currentRoomId;
}

// ============================
// 3. Присоединение к комнате (Callee)
// ============================

/**
 * Присоединяется к существующей комнате.
 * Отвечающий (callee) знает roomId и подключается.
 *
 * @param {string} roomId — ID комнаты для подключения
 * @returns {Promise<void>}
 */
export async function joinRoom(roomId) {
  _ensureInitialized();

  if (!roomId || typeof roomId !== 'string') {
    throw new Error('joinRoom: roomId обязателен');
  }

  // Очистить предыдущую сессию если есть
  if (currentRoomId) {
    await cleanup();
  }

  currentRoomId = roomId;
  currentRole = 'callee';

  log('Signaling', `📱 Подключение к комнате: ${currentRoomId} (роль: callee)`);

  // Подписаться на входящие сигналы
  _subscribeToRoom();

  isConnected = true;
}

// ============================
// 4. Отправка сигналов
// ============================

/**
 * Отправляет сигнал через Supabase (INSERT в таблицу signaling).
 *
 * @param {'offer' | 'answer' | 'ice-candidate' | 'hangup'} type — тип сигнала
 * @param {object} payload — данные сигнала (SDP, ICE candidate и т.д.)
 * @returns {Promise<void>}
 */
export async function sendSignal(type, payload) {
  _ensureInitialized();

  if (!currentRoomId || !currentRole) {
    throw new Error('sendSignal: сначала создайте или присоединитесь к комнате');
  }

  const record = {
    room_id: currentRoomId,
    type,
    payload,
    sender: currentRole,
  };

  log('Signaling', `📤 Отправка: ${type}`);

  const { error } = await supabase.from(SIGNALING_TABLE).insert(record);

  if (error) {
    log('Signaling', `❌ Ошибка отправки: ${error.message}`);
    throw error;
  }

  log('Signaling', `✅ Отправлено: ${type}`);
}

// ============================
// 5. Подписка на входящие сигналы
// ============================

/**
 * Регистрирует колбэк для обработки входящих сигналов.
 * Колбэк вызывается с объектом { type, payload, sender }.
 *
 * @param {function({ type: string, payload: object, sender: string }): void} callback
 * @returns {function} — функция отписки
 */
export function onSignal(callback) {
  if (typeof callback !== 'function') {
    throw new Error('onSignal: callback должен быть функцией');
  }

  signalListeners.push(callback);
  log('Signaling', `👂 Слушатель добавлен (всего: ${signalListeners.length})`);

  // Вернуть функцию отписки
  return () => {
    const idx = signalListeners.indexOf(callback);
    if (idx !== -1) {
      signalListeners.splice(idx, 1);
      log('Signaling', `🔇 Слушатель удалён (осталось: ${signalListeners.length})`);
    }
  };
}

// ============================
// 6. Очистка
// ============================

/**
 * Отписывается от канала Supabase, сбрасывает состояние.
 * Вызывать при завершении звонка или при ошибке.
 *
 * @returns {Promise<void>}
 */
export async function cleanup() {
  log('Signaling', '🧹 Очистка...');

  // Отписаться от Realtime-канала
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
    log('Signaling', '  ↳ Канал отключён.');
  }

  // Удалить старые записи из БД (опционально, чтобы не засорять)
  if (currentRoomId) {
    const { error } = await supabase
      .from(SIGNALING_TABLE)
      .delete()
      .eq('room_id', currentRoomId);

    if (error) {
      log('Signaling', `  ↳ Не удалось очистить записи: ${error.message}`);
    } else {
      log('Signaling', '  ↳ Записи комнаты удалены из БД.');
    }
  }

  // Сбросить состояние
  currentRoomId = null;
  currentRole = null;
  isConnected = false;
  signalListeners.length = 0;
  presenceListeners.length = 0; // Очищаем слушателей присутствия

  log('Signaling', '✅ Очистка завершена.');
}

// ============================
// 7. Геттер состояния
// ============================

/**
 * Возвращает текущее состояние модуля сигналинга.
 *
 * @returns {{ roomId: string | null, role: string | null, isConnected: boolean }}
 */
export function getState() {
  return {
    roomId: currentRoomId,
    role: currentRole,
    isConnected,
  };
}

// ============================
// Приватные функции
// ============================

/**
 * Проверяет, что Supabase-клиент инициализирован.
 * @private
 */
function _ensureInitialized() {
  if (!supabase) {
    throw new Error('Signaling не инициализирован. Вызовите initSignaling() сначала.');
  }
}

/**
 * Подписывается на Realtime-обновления комнаты.
 * Фильтрует входящие сигналы: пропускает только чужие (от другой стороны).
 * @private
 */
function _subscribeToRoom() {
  if (!currentRoomId) return;

  const peerRole = currentRole === 'caller' ? 'callee' : 'caller';

  channel = supabase
    .channel(`room:${currentRoomId}`, {
      config: {
        presence: {
          key: currentRole,
        },
      },
    })
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      // Собеседник в сети, если его роль присутствует в списке ключей
      const isPeerOnline = !!state[peerRole];
      log('Presence', `👥 Собеседник ${peerRole} ${isPeerOnline ? 'в сети' : 'не в сети'}`);
      
      presenceListeners.forEach(listener => {
        try {
          listener(isPeerOnline);
        } catch (e) {
          log('Presence', `❌ Ошибка в слушателе присутствия: ${e.message}`);
        }
      });
    })
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: SIGNALING_TABLE,
        filter: `room_id=eq.${currentRoomId}`,
      },
      (change) => {
        const record = change.new;

        // Пропускаем свои собственные сообщения
        if (record.sender === currentRole) return;

        log('Signaling', `📥 Получен: ${record.type} от ${record.sender}`);

        // Уведомить всех слушателей
        const signal = {
          type: record.type,
          payload: record.payload,
          sender: record.sender,
        };

        for (const listener of signalListeners) {
          try {
            listener(signal);
          } catch (err) {
            log('Signaling', `❌ Ошибка в слушателе: ${err.message}`);
          }
        }
      }
    )
    .subscribe(async (status) => {
      log('Signaling', `📡 Статус подписки: ${status}`);
      if (status === 'SUBSCRIBED') {
        try {
          // Регистрируем свое присутствие в комнате
          await channel.track({ online_at: new Date().toISOString() });
          log('Presence', '✅ Свое присутствие зарегистрировано.');
        } catch (err) {
          log('Presence', `⚠️ Не удалось зарегистрировать присутствие: ${err.message}`);
        }
      }
    });
}
