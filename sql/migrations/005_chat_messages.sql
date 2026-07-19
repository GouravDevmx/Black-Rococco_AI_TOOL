-- ============================================================================
-- Migration 005: Chat messages (client <-> salon messaging)
-- Run in Supabase -> SQL Editor AFTER 004_client_auth_and_blogs.sql.
-- ============================================================================
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  thread_id text not null,
  sender text not null default 'client',
  name text not null default 'Visitante',
  text text not null default '',
  read_by_admin boolean not null default false,
  read_by_client boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_salon on chat_messages(salon_id);
create index if not exists idx_chat_messages_thread on chat_messages(salon_id, thread_id, created_at);
create index if not exists idx_chat_messages_unread on chat_messages(salon_id, read_by_admin) where read_by_admin = false;
alter table chat_messages enable row level security;

insert into schema_migrations (version) values ('005_chat_messages')
  on conflict (version) do nothing;
