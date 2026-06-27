-- Таблица сигналинга для WebRTC
create table if not exists public.signaling (
  id uuid default gen_random_uuid() primary key,
  room_id text not null,
  type text not null,
  payload jsonb not null,
  sender text not null,
  created_at timestamptz default now()
);

-- Индекс для быстрой фильтрации по room_id
create index if not exists idx_signaling_room_id on public.signaling(room_id);

-- Включить RLS
alter table public.signaling enable row level security;

-- RLS-политика: анонимные могут читать по room_id
create policy "Allow anonymous select" on public.signaling
  for select using (true);

-- RLS-политика: анонимные могут вставлять
create policy "Allow anonymous insert" on public.signaling
  for insert with check (true);

-- RLS-политика: анонимные могут удалять (для cleanup)
create policy "Allow anonymous delete" on public.signaling
  for delete using (true);

-- Включить Realtime для таблицы
alter publication supabase_realtime add table public.signaling;
