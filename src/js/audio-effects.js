/**
 * audio-effects.js — Синтезатор звуковых эффектов (Web Audio API)
 *
 * Синтезирует все телефонные звуки (гудки, рингтон, сброс) без использования тяжелых mp3 файлов.
 * Это гарантирует 100% работу в офлайне без кэширования медиа-ресурсов.
 *
 * Эффекты:
 * - playRingtone()    — Рингтон при входящем вызове (мелодичный синтезированный перебор)
 * - stopRingtone()    — Остановить рингтон
 * - playDialTone()    — Исходящие гудки (ожидание ответа)
 * - stopDialTone()    — Остановить гудки
 * - playConnectTone() — Звук успешного соединения (восходящий тон)
 * - playDisconnectTone() — Звук сброса/ошибки (нисходящий тон)
 */

import { log } from './utils.js';

let audioCtx = null;
let ringtoneInterval = null;
let dialToneInterval = null;

// Множитель громкости (по умолчанию 0.5)
let ringtoneVolume = 0.5;

/**
 * Устанавливает громкость воспроизведения эффектов.
 * @param {number} vol - громкость от 0.0 до 1.0
 */
export function setRingtoneVolume(vol) {
  ringtoneVolume = Math.max(0, Math.min(1, vol));
  log('AudioEffects', `🔊 Громкость установлена на: ${ringtoneVolume}`);
}

/**
 * Инициализирует аудио контекст при первом взаимодействии пользователя.
 * @private
 */
function _getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ============================
// 1. Входящий рингтон
// ============================

/**
 * Запускает проигрывание мелодии входящего вызова.
 */
export function playRingtone() {
  stopRingtone();
  const ctx = _getAudioContext();
  log('AudioEffects', '🔊 Запуск входящего рингтона');

  let time = ctx.currentTime;
  
  const playMelodyStep = () => {
    const now = ctx.currentTime;
    // Короткая приятная цифровая мелодия (арпеджио)
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      
      gainNode.gain.setValueAtTime(0.15 * ringtoneVolume, now + idx * 0.12);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.3);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.3);
    });
  };

  // Проигрываем мелодию сразу
  playMelodyStep();
  // Повторяем каждые 1.5 секунды
  ringtoneInterval = setInterval(playMelodyStep, 1500);
}

/**
 * Останавливает рингтон входящего вызова.
 */
export function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
    log('AudioEffects', '🔇 Входящий рингтон остановлен');
  }
}

// ============================
// 2. Исходящие гудки (Dial Tone)
// ============================

/**
 * Запускает исходящие гудки (ожидание ответа).
 * Стандартный европейский сигнал: 425 Гц (1 секунда звук, 4 секунды тишина).
 */
export function playDialTone() {
  stopDialTone();
  const ctx = _getAudioContext();
  log('AudioEffects', '🔊 Запуск исходящих гудков');

  const playBeep = () => {
    const now = ctx.currentTime;
    
    // Создаем два осциллятора для придания объемного звука классического гудка (425 Гц + 400 Гц)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc1.frequency.setValueAtTime(425, now);
    osc2.frequency.setValueAtTime(400, now);
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.08 * ringtoneVolume, now + 0.05); // Плавное нарастание
    gainNode.gain.setValueAtTime(0.08 * ringtoneVolume, now + 0.95);
    gainNode.gain.linearRampToValueAtTime(0, now + 1.0); // Плавное затухание
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc1.start(now);
    osc2.start(now);
    
    osc1.stop(now + 1.0);
    osc2.stop(now + 1.0);
  };

  playBeep();
  // Цикл каждые 4 секунды (1с звук + 3с пауза)
  dialToneInterval = setInterval(playBeep, 4000);
}

/**
 * Останавливает исходящие гудки.
 */
export function stopDialTone() {
  if (dialToneInterval) {
    clearInterval(dialToneInterval);
    dialToneInterval = null;
    log('AudioEffects', '🔇 Исходящие гудки остановлены');
  }
}

// ============================
// 3. Звук успешного подключения
// ============================

/**
 * Проигрывает восходящий двухтональный сигнал соединения.
 */
export function playConnectTone() {
  const ctx = _getAudioContext();
  const now = ctx.currentTime;
  log('AudioEffects', '🔊 Звук подключения');

  const frequencies = [480, 640]; // Восходящие тона
  frequencies.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'triangle'; // Более мягкий звук
    osc.frequency.setValueAtTime(freq, now + idx * 0.1);
    
    gainNode.gain.setValueAtTime(0.12 * ringtoneVolume, now + idx * 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.25);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now + idx * 0.1);
    osc.stop(now + idx * 0.1 + 0.25);
  });
}

// ============================
// 4. Звук отключения / ошибки
// ============================

/**
 * Проигрывает нисходящий трехтональный сигнал сброса звонка.
 */
export function playDisconnectTone() {
  const ctx = _getAudioContext();
  const now = ctx.currentTime;
  log('AudioEffects', '🔊 Звук отключения');

  const frequencies = [300, 240, 180]; // Нисходящие тона
  frequencies.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'sawtooth'; // Характерный телефонный сброс
    osc.frequency.setValueAtTime(freq, now + idx * 0.12);
    
    // Lowpass filter для придания более мягкого аналогового звука
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);

    gainNode.gain.setValueAtTime(0.1 * ringtoneVolume, now + idx * 0.12);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.2);
    
    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now + idx * 0.12);
    osc.stop(now + idx * 0.12 + 0.2);
  });
}
