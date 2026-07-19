-- ============================================================================
-- MIGRATION 002 — staff, client photos, promotion images
--
-- Run ONCE in Supabase -> SQL Editor. Idempotent: safe to run twice.
--
-- NOTE: an earlier draft of this file declared these tables with `text` ids.
-- That was wrong and would NOT run: every table in schema.sql uses
--   id uuid primary key default gen_random_uuid()
-- and Postgres refuses a foreign key whose type differs from the column it
-- references ("key columns are of incompatible types: text and uuid").
-- Everything below now matches the existing schema exactly.
-- ============================================================================

-- 1. STAFF — the team, shown publicly on the homepage
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references salons(id) on delete cascade,
  name        text not null default '',
  role        text not null default '',
  bio         text not null default '',
  photo_url   text not null default '',
  instagram   text not null default '',
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_staff_salon on staff(salon_id, sort_order);

-- 2. CLIENT_PHOTOS — consultation / before-after photos.
--
-- PRIVACY: photos of identifiable clients' hands and nails. Served ONLY by
-- authenticated admin routes — never by /api/config or any public endpoint.
--
-- client_id      on delete cascade: erasing a client erases her photos.
-- appointment_id on delete set null: deleting an appointment must not destroy
--                the photo, which still belongs to the client.
create table if not exists client_photos (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references salons(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  url            text not null,
  note           text not null default '',
  phase          text not null default 'after',   -- 'before' | 'after' | 'reference'
  created_at     timestamptz not null default now()
);
create index if not exists idx_client_photos_client on client_photos(client_id);
create index if not exists idx_client_photos_salon on client_photos(salon_id, created_at desc);

-- 3. PROMOTIONS — one image per promotion
alter table promotions add column if not exists image_url text not null default '';

-- About Us images need no migration: they live in the existing
-- salons.salon_config JSONB column under the `aboutUs` key.

-- Record that this migration has been applied (see schema_migrations).
insert into schema_migrations (version) values ('002_media_surfaces')
  on conflict (version) do nothing;
