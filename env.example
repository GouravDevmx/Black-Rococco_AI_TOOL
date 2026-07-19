-- ============================================================================
-- REPAIR SCRIPT — run this ONCE in Supabase -> SQL Editor to fix production.
--
-- Fixes two incidents seen in the logs:
--   1. "Could not find the table 'public.chat_messages'"  -> migration 005
--      was never run. Created idempotently below.
--   2. "salons: Cannot coerce the result to a single JSON object" -> the
--      salon row the server resolved at boot no longer exists under that id
--      (seed SQL re-run recreated it with a new UUID) OR duplicate rows
--      exist. The diagnostics below show which; the cleanup keeps the OLDEST
--      active row per slug and deactivates the rest.
--
-- The app now also self-heals from a recreated salon id at runtime, but the
-- database should still be left in a clean state.
-- ============================================================================

-- ---------- STEP 1: DIAGNOSE — how many salon rows exist? ----------
select id, slug, name, active, created_at
from salons
order by created_at;
-- Expected: exactly ONE row with your slug (default 'black-rococo'), active.

-- ---------- STEP 2: DEDUPE salons (safe no-op if only one row) ----------
-- Keeps the oldest active row per slug; deactivates newer duplicates so no
-- foreign keys break. Nothing is deleted.
update salons s
set active = false
where s.active = true
  and exists (
    select 1 from salons older
    where older.slug = s.slug
      and older.active = true
      and older.created_at < s.created_at
  );

-- ---------- STEP 3: chat_messages (migration 005, idempotent) ----------
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

-- ---------- STEP 4: 004 tables too, in case that migration was also missed ----------
create table if not exists client_accounts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  whatsapp text not null,
  password_hash text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, whatsapp)
);
create index if not exists idx_client_accounts_salon on client_accounts(salon_id);
create index if not exists idx_client_accounts_client on client_accounts(client_id);
alter table client_accounts enable row level security;

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  title text not null default '',
  slug text not null default '',
  excerpt text not null default '',
  body text not null default '',
  cover_image_url text not null default '',
  published boolean not null default false,
  tags jsonb not null default '[]'::jsonb,
  author text not null default 'Black Rococo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_blog_posts_salon on blog_posts(salon_id);
create index if not exists idx_blog_posts_published on blog_posts(salon_id, published);
alter table blog_posts enable row level security;

-- ---------- STEP 5: record migrations as applied ----------
insert into schema_migrations (version) values
  ('004_client_auth_and_blogs'),
  ('005_chat_messages')
on conflict (version) do nothing;

-- ---------- STEP 6: VERIFY ----------
select 'salons active' as check, count(*)::text as result from salons where active = true
union all
select 'chat_messages exists', to_regclass('public.chat_messages') is not null::text
union all
select 'client_accounts exists', to_regclass('public.client_accounts') is not null::text
union all
select 'blog_posts exists', to_regclass('public.blog_posts') is not null::text;
-- Expected: salons active = 1, and all three "exists" checks = true.
-- After running: redeploy (or just wait — the app now re-resolves the salon
-- automatically on the next request).
