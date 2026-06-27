-- Таблица для логов диагностики и ошибок
create table if not exists public.diagnostics (
  id uuid default gen_random_uuid() primary key,
  room_id text,
  level text not null, -- 'error' | 'warn' | 'info'
  message text not null,
  details jsonb,
  created_at timestamptz default now()
);

-- Индекс для быстрого поиска логов комнаты
create index if not exists idx_diagnostics_room_id on public.diagnostics(room_id);

-- Разрешить анонимные вставки логов
alter table public.diagnostics enable row level security;

create policy "Allow anonymous insert diagnostics" on public.diagnostics
  for insert with check (true);
