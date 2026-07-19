-- ============================================================================
-- Black Rococo — CLEAN SLATE schema (single salon)
-- Run this ONCE in Supabase → SQL Editor, on top of your existing project.
-- This DROPS every table this app uses and recreates them fresh. Only run
-- this if you're fine losing whatever test data is currently in there.
-- ============================================================================

drop table if exists notifications cascade;
drop table if exists posts cascade;
drop table if exists course_registrations cascade;
drop table if exists courses cascade;
drop table if exists media cascade;
drop table if exists promotions cascade;
drop table if exists appointments cascade;
drop table if exists services cascade;
drop table if exists clients cascade;
drop table if exists salon_admins cascade;
drop table if exists salons cascade;
drop function if exists increment_promo_usage(uuid);

-- ----------------------------------------------------------------------------
-- SALONS — single row in this table, kept as a table (not hardcoded) so the
-- data shape stays identical to how the app already reads/writes it.
-- ----------------------------------------------------------------------------
create table if not exists salons (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  business_type text not null default 'nails',
  brand jsonb not null default '{}'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  booking jsonb not null default '{}'::jsonb,
  featured_service_ids jsonb not null default '[]'::jsonb,
  google_calendar jsonb not null default '{}'::jsonb,
  salon_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- CLIENTS
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  instagram text not null default '',
  birthday text not null default '',
  style_choice text not null default '',
  color_choice text not null default '',
  drink_choice text not null default '',
  time_preference text not null default '',
  notes text not null default '',
  allergies text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, whatsapp)
);
create index if not exists idx_clients_salon on clients(salon_id);

-- ----------------------------------------------------------------------------
-- SERVICES
-- ----------------------------------------------------------------------------
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  cat text not null default '',
  name text not null default '',
  description text not null default '',
  price integer not null default 0,
  duration_minutes integer not null default 30,
  image_url text not null default '',
  image_urls jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_services_salon on services(salon_id);

-- ----------------------------------------------------------------------------
-- APPOINTMENTS — the unique index is real DB-level double-booking protection.
-- google_event_id links to the auto-created Google Calendar event.
-- ----------------------------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  folio_number bigserial,
  salon_id uuid not null references salons(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  service_name_snapshot text not null default '',
  appt_date date not null,
  appt_time text not null,
  status text not null default 'new',
  preferences_snapshot jsonb not null default '{}'::jsonb,
  final_price integer not null default 0,
  original_price integer not null default 0,
  applied_promotion jsonb,
  reminders_sent jsonb not null default '{}'::jsonb,
  google_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_appt_salon_date on appointments(salon_id, appt_date);
create index if not exists idx_appt_client on appointments(client_id);
create unique index if not exists uq_appt_slot
  on appointments(salon_id, appt_date, appt_time)
  where status <> 'cancelled';

-- ----------------------------------------------------------------------------
-- PROMOTIONS
-- ----------------------------------------------------------------------------
create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  code text not null default '',
  label text not null default '',
  title text not null default '',
  note text not null default '',
  discount_type text not null default 'percent',
  value numeric not null default 0,
  scope text not null default 'all',
  category_value text not null default '',
  service_ids jsonb not null default '[]'::jsonb,
  start_date date,
  end_date date,
  active boolean not null default true,
  auto_apply boolean not null default true,
  usage_limit integer not null default 0,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_promo_salon on promotions(salon_id);

create or replace function increment_promo_usage(promo_id uuid)
returns void as $$
  update promotions set usage_count = usage_count + 1, updated_at = now() where id = promo_id;
$$ language sql;

-- ----------------------------------------------------------------------------
-- COURSES + REGISTRATIONS
-- ----------------------------------------------------------------------------
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  price integer not null default 0,
  duration text not null default '',
  level text not null default '',
  image_urls jsonb not null default '[]'::jsonb,
  capacity integer not null default 0,
  start_date date,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_courses_salon on courses(salon_id);

create table if not exists course_registrations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  course_id uuid references courses(id) on delete cascade,
  name text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  notes text not null default '',
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists idx_courseregs_salon on course_registrations(salon_id);

-- ----------------------------------------------------------------------------
-- MEDIA LIBRARY (gallery + homepage carousel)
-- ----------------------------------------------------------------------------
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  kind text not null default 'image',
  url text not null,
  poster_url text not null default '',
  title text not null default '',
  description text not null default '',
  category text not null default '',
  sort_order integer not null default 0,
  show_in_carousel boolean not null default false,
  show_in_gallery boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_media_salon on media(salon_id);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS (admin panel bell)
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  kind text not null default '',
  channel text not null default 'admin_panel',
  title text not null default '',
  message text not null default '',
  status text not null default 'unread',
  action_label text not null default '',
  action_url text not null default '',
  error text not null default '',
  unread boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notifications_salon on notifications(salon_id, unread);

-- ----------------------------------------------------------------------------
-- POSTS (legacy "publish to social" tracking — kept for continuity)
-- ----------------------------------------------------------------------------
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  caption text not null default '',
  image_url text not null default '',
  targets jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now()
);
create index if not exists idx_posts_salon on posts(salon_id);

-- ============================================================================
-- ROW LEVEL SECURITY — RLS on, no policies granted to anon/authenticated.
-- Only your server's service_role key (which bypasses RLS by design) can
-- read/write anything here.
-- ============================================================================
alter table salons enable row level security;
alter table clients enable row level security;
alter table services enable row level security;
alter table appointments enable row level security;
alter table promotions enable row level security;
alter table courses enable row level security;
alter table course_registrations enable row level security;
alter table media enable row level security;
alter table notifications enable row level security;
alter table posts enable row level security;

-- ============================================================================
-- SEED: the one salon this app serves. Edit branding/hours freely afterward
-- from the Supabase table editor, or once an admin settings screen exists.
-- ============================================================================
insert into salons (slug, name, business_type, brand, contact, booking, featured_service_ids)
values (
  'nails',
  'Black Rococo',
  'nails',
  '{"heroTitle":"Uñas de revista, hechas a tu medida","heroSubtitle":"EDITORIAL NAILS, MADE FOR YOU","specialties":"MANICURE RUSO · POLIGEL","rating":"4.9","socialProof":"+600 clientas felices","footer":"© 2026 BLACK ROCOCO"}'::jsonb,
  '{"whatsappNumber":"33 2655 3522","hours1":"Lun – Sáb · 10:00 – 20:00","hours2":"Domingo cerrado"}'::jsonb,
  '{"times":["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"],"confirmNote":"Te esperamos en punto. Cancelaciones con 12h de anticipación por WhatsApp."}'::jsonb,
  '[]'::jsonb
);

-- ============================================================================
-- MIGRATION TRACKING  (STORY 2.7)
--
-- Records which migration files have been applied, so a database can always be
-- told apart from a half-migrated one. Without this there is no way to know
-- whether 002 and 003 have run — and re-running the wrong thing, or skipping
-- one, is how a schema silently drifts from the application.
--
-- Every migration file ends by inserting its own name here.
-- ============================================================================
create table if not exists schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

insert into schema_migrations (version) values ('001_schema')
  on conflict (version) do nothing;
