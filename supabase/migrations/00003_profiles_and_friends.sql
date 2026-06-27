-- Таблица профилей пользователей
create table if not exists public.profiles (
  id uuid default gen_random_uuid() primary key,
  user_code text unique not null,
  nickname text not null,
  created_at timestamptz default now()
);

-- Индекс для быстрого поиска по user_code
create index if not exists idx_profiles_user_code on public.profiles(user_code);

-- Функция генерации уникального 6-значного кода
create or replace function public.generate_unique_user_code()
returns text as $$
declare
  new_code text;
  exists_already boolean;
begin
  loop
    -- Генерируем 6 случайных цифр и дополняем нулями слева
    new_code := lpad(floor(random() * 1000000)::text, 6, '0');
    select exists(select 1 from public.profiles where user_code = new_code) into exists_already;
    if not exists_already then
      return new_code;
    end if;
  end loop;
end;
$$ language plpgsql;

-- Триггер для автоматического назначения user_code перед вставкой
create or replace function public.set_user_code()
returns trigger as $$
begin
  if new.user_code is null then
    new.user_code := public.generate_unique_user_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_set_user_code on public.profiles;
create trigger tr_set_user_code
  before insert on public.profiles
  for each row
  execute function public.set_user_code();


-- Таблица друзей (связи один к одному)
create table if not exists public.friends (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  friend_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, friend_id)
);

-- Индексы для оптимизации выборок
create index if not exists idx_friends_user_id on public.friends(user_id);
create index if not exists idx_friends_friend_id on public.friends(friend_id);

-- Функция автоматического создания взаимной дружбы
create or replace function public.auto_create_mutual_friendship()
returns trigger as $$
begin
  -- Проверяем, существует ли уже взаимная строка дружбы, если нет — вставляем её
  if not exists (
    select 1 from public.friends 
    where user_id = new.friend_id and friend_id = new.user_id
  ) then
    insert into public.friends (user_id, friend_id)
    values (new.friend_id, new.user_id);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_mutual_friendship on public.friends;
create trigger tr_mutual_friendship
  after insert on public.friends
  for each row
  execute function public.auto_create_mutual_friendship();


-- Функция удаления взаимной дружбы при отписке
create or replace function public.auto_delete_mutual_friendship()
returns trigger as $$
begin
  -- Удаляем вторую сторону дружбы
  delete from public.friends 
  where user_id = old.friend_id and friend_id = old.user_id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists tr_delete_mutual_friendship on public.friends;
create trigger tr_delete_mutual_friendship
  after delete on public.friends
  for each row
  execute function public.auto_delete_mutual_friendship();


-- === Включение RLS (Row Level Security) ===

alter table public.profiles enable row level security;

create policy "Allow anonymous select profiles" on public.profiles
  for select using (true);

create policy "Allow anonymous insert profiles" on public.profiles
  for insert with check (true);

create policy "Allow anonymous update profiles" on public.profiles
  for update using (true);


alter table public.friends enable row level security;

create policy "Allow anonymous select friends" on public.friends
  for select using (true);

create policy "Allow anonymous insert friends" on public.friends
  for insert with check (true);

create policy "Allow anonymous delete friends" on public.friends
  for delete using (true);


-- === Включение Realtime публикаций ===
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.friends;
