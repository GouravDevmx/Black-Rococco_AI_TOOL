-- ============================================================================
-- Migration 004: Client accounts (register/login) + Blog posts
-- Run in Supabase -> SQL Editor AFTER 003_indexes.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CLIENT ACCOUNTS — optional registration for clients who want to see their
-- appointment history. Linked to the existing clients table by whatsapp+salon.
-- Guests (unregistered) continue to book normally; this adds an OPT-IN layer.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- BLOG POSTS — admin-created articles visible to all visitors (no login
-- required to read). Rich text stored as HTML in the body column.
-- ----------------------------------------------------------------------------
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

-- Track this migration
insert into schema_migrations (version) values ('004_client_auth_and_blogs')
  on conflict (version) do nothing;
