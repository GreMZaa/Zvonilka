/**
 * utils.js — Утилиты и вспомогательные функции
 * 
 * Общие хелперы, которые используются в разных модулях:
 * - Генерация уникальных ID
 * - Логирование
 * - Работа с таймерами
 */

/**
 * Генерирует короткий уникальный идентификатор.
 * @returns {string}
 */
export function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Логирование с временной меткой.
 * @param {string} module - Имя модуля
 * @param  {...any} args - Аргументы для console.log
 */
export function log(module, ...args) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${module}]`, ...args);
}
