/**
 * profile.js — Модуль профилей и списка друзей (Supabase + LocalStorage)
 */

import { getSupabase } from './signaling.js';
import { log } from './utils.js';

const LOCAL_STORAGE_KEY = 'zvonilka_profile';

// === Получение локального профиля ===
export function getLocalProfile() {
  const profileJson = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!profileJson) return null;
  try {
    return JSON.parse(profileJson);
  } catch (e) {
    log('Profile', '❌ Ошибка парсинга локального профиля:', e);
    return null;
  }
}

// === Создание нового профиля ===
export async function createProfile(nickname) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client not initialized');

  if (!nickname || typeof nickname !== 'string' || nickname.trim() === '') {
    throw new Error('Имя профиля не может быть пустым');
  }

  log('Profile', `👤 Создание профиля для: ${nickname}...`);

  // Вставляем профиль в БД. user_code сгенерируется автоматически триггером
  const { data, error } = await supabase
    .from('profiles')
    .insert({ nickname: nickname.trim() })
    .select()
    .single();

  if (error) {
    log('Profile', '❌ Ошибка создания профиля в БД:', error.message);
    throw error;
  }

  const profile = {
    id: data.id,
    user_code: data.user_code,
    nickname: data.nickname,
  };

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
  log('Profile', `✅ Профиль сохранен локально: ${profile.nickname} (Код: ${profile.user_code})`);
  return profile;
}

// === Обновление имени ===
export async function updateLocalNickname(nickname) {
  const supabase = getSupabase();
  const profile = getLocalProfile();
  if (!supabase || !profile) return;

  const newNickname = nickname.trim();
  if (newNickname === '') return;

  const { error } = await supabase
    .from('profiles')
    .update({ nickname: newNickname })
    .eq('id', profile.id);

  if (error) {
    log('Profile', '❌ Ошибка обновления имени:', error.message);
    throw error;
  }

  profile.nickname = newNickname;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(profile));
  log('Profile', `✅ Никнейм изменен на: ${newNickname}`);
}

// === Загрузка списка друзей ===
export async function loadFriends() {
  const supabase = getSupabase();
  const profile = getLocalProfile();
  if (!supabase || !profile) return [];

  log('Profile', '🔄 Загрузка списка друзей...');

  // 1. Получаем список ID друзей из таблицы friends
  const { data: relations, error: relError } = await supabase
    .from('friends')
    .select('friend_id')
    .eq('user_id', profile.id);

  if (relError) {
    log('Profile', '❌ Ошибка получения связей дружбы:', relError.message);
    throw relError;
  }

  if (!relations || relations.length === 0) {
    return [];
  }

  const friendIds = relations.map(r => r.friend_id);

  // 2. Получаем профили друзей по их ID
  const { data: friendProfiles, error: profError } = await supabase
    .from('profiles')
    .select('id, user_code, nickname')
    .in('id', friendIds);

  if (profError) {
    log('Profile', '❌ Ошибка получения профилей друзей:', profError.message);
    throw profError;
  }

  log('Profile', `✅ Успешно загружено друзей: ${friendProfiles.length}`);
  return friendProfiles;
}

// === Добавление друга по коду ===
export async function addFriendByCode(code) {
  const supabase = getSupabase();
  const profile = getLocalProfile();
  if (!supabase || !profile) throw new Error('Профиль не инициализирован');

  const cleanCode = code.trim().replace(/\s+/g, ''); // Удаляем пробелы
  if (cleanCode.length !== 6 || !/^\d+$/.test(cleanCode)) {
    throw new Error('Код должен состоять ровно из 6 цифр');
  }

  if (cleanCode === profile.user_code) {
    throw new Error('Нельзя добавить в друзья самого себя');
  }

  log('Profile', `🔄 Поиск друга по коду: ${cleanCode}...`);

  // Ищем профиль друга по user_code
  const { data: targetProfile, error: searchError } = await supabase
    .from('profiles')
    .select('id, nickname')
    .eq('user_code', cleanCode)
    .maybeSingle();

  if (searchError) {
    log('Profile', '❌ Ошибка при поиске друга:', searchError.message);
    throw searchError;
  }

  if (!targetProfile) {
    throw new Error('Пользователь с таким кодом не найден');
  }

  log('Profile', `👤 Найден пользователь: ${targetProfile.nickname}. Добавление...`);

  // Вставляем связь в БД. Взаимная связь (B, A) создастся триггером в БД
  const { error: insertError } = await supabase
    .from('friends')
    .insert({
      user_id: profile.id,
      friend_id: targetProfile.id,
    });

  if (insertError) {
    // Проверяем на дубликаты
    if (insertError.code === '23505') {
      throw new Error(`${targetProfile.nickname} уже есть в вашем списке друзей`);
    }
    log('Profile', '❌ Ошибка вставки связи дружбы:', insertError.message);
    throw insertError;
  }

  log('Profile', `✅ Друг добавлен: ${targetProfile.nickname}`);
  return targetProfile;
}

// === Удаление друга ===
export async function removeFriend(friendId) {
  const supabase = getSupabase();
  const profile = getLocalProfile();
  if (!supabase || !profile) return;

  log('Profile', `🗑️ Удаление друга: ${friendId}`);

  const { error } = await supabase
    .from('friends')
    .delete()
    .eq('user_id', profile.id)
    .eq('friend_id', friendId);

  if (error) {
    log('Profile', '❌ Ошибка при удалении друга:', error.message);
    throw error;
  }

  log('Profile', '✅ Друг успешно удален.');
}

// === Подписка на изменения списка друзей ===
export function subscribeToFriends(onUpdate) {
  const supabase = getSupabase();
  const profile = getLocalProfile();
  if (!supabase || !profile) return null;

  log('Profile', '👂 Подписка на обновления списка друзей...');

  const channel = supabase
    .channel('friends_updates')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'friends',
        filter: `user_id=eq.${profile.id}`,
      },
      (payload) => {
        log('Profile', '⚡ Изменение списка друзей в БД, обновление UI...');
        onUpdate(payload);
      }
    )
    .subscribe();

  return channel;
}

// === Управление Присутствием (Online Status) ===
let presenceChannel = null;

export function initPresence(myProfile, onPresenceSync) {
  const supabase = getSupabase();
  if (!supabase || !myProfile) return null;

  if (presenceChannel) {
    supabase.removeChannel(presenceChannel);
  }

  log('Profile', '🟢 Инициализация присутствия в сети...');

  presenceChannel = supabase.channel('presence:global', {
    config: {
      presence: {
        key: myProfile.id,
      },
    },
  });

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      // Извлекаем все ID пользователей, которые сейчас в сети
      const onlineUserIds = Object.keys(state);
      onPresenceSync(onlineUserIds);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Трекаем свой статус в сети
        await presenceChannel.track({
          nickname: myProfile.nickname,
          online: true,
          at: new Date().toISOString(),
        });
      }
    });

  return presenceChannel;
}
