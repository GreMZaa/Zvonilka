/**
 * config.js — Конфигурация приложения
 * Все настройки в одном месте: серверы, ключи, параметры.
 */

// === Supabase ===
export const SUPABASE_URL = 'https://otlfkspzgaegrgtoidzm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90bGZrc3B6Z2FlZ3JndG9pZHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjkxNjYsImV4cCI6MjA5ODEwNTE2Nn0.IhhR8ICg6Wx2_i49fJYmrmYYEkid0GdOnQE_ECsGcGo';

// === ICE-серверы (STUN + TURN) ===
export const ICE_SERVERS = [
  // Google STUN (бесплатно, без лимитов)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },

  // Бесплатный TURN от OpenRelay (relay.metered.ca)
  // Заменить на свои данные с metered.ca когда зарегистрируешься
  {
    urls: 'turn:a.relay.metered.ca:80',
    username: 'e8dd65b92f6ebc3e0306cc68',
    credential: '1ZuMN/HjKuSmJn1N',
  },
  {
    urls: 'turn:a.relay.metered.ca:80?transport=tcp',
    username: 'e8dd65b92f6ebc3e0306cc68',
    credential: '1ZuMN/HjKuSmJn1N',
  },
  {
    urls: 'turn:a.relay.metered.ca:443',
    username: 'e8dd65b92f6ebc3e0306cc68',
    credential: '1ZuMN/HjKuSmJn1N',
  },
  {
    urls: 'turns:a.relay.metered.ca:443?transport=tcp',
    username: 'e8dd65b92f6ebc3e0306cc68',
    credential: '1ZuMN/HjKuSmJn1N',
  },
];

// === Supabase таблицы ===
export const SIGNALING_TABLE = 'signaling';

// === Таймауты и параметры ===
export const CONNECTION_TIMEOUT_MS = 30000; // 30 сек на установку соединения
export const ICE_GATHERING_TIMEOUT_MS = 5000; // 5 сек на сбор ICE-кандидатов
export const ROOM_ID_LENGTH = 8; // Длина ID комнаты
