-- ============================================================================
-- MIGRATION 003 — INDEXES  (STORY 2.3)
--
-- Run ONCE in Supabase -> SQL Editor. Idempotent and non-destructive: it only
-- adds indexes. No data is touched, no column is altered. Safe on a live table.
--
-- WHY THESE, SPECIFICALLY
--
-- After the Story 2.5 read rewrite, EVERY read the application issues has the
-- same shape:
--
--     SELECT * FROM <table>
--      WHERE salon_id = $1
--      ORDER BY <sort column>, id      -- stable sort, required for pagination
--      LIMIT 1000 OFFSET $2            -- paginated to defeat Supabase's cap
--
-- The existing indexes only cover `salon_id`. That lets Postgres find the rows,
-- but it must then SORT ALL OF THEM on every single request before it can
-- return even the first page. On a 100,000-row media table that sort is the
-- entire cost of the query.
--
-- An index on (salon_id, <sort column>, id) matches the query exactly: Postgres
-- walks it in order and stops at LIMIT. No sort step at all.
--
-- Indexes are CONCURRENTLY-safe to add on a live table, but Supabase's SQL
-- editor runs inside a transaction, where CREATE INDEX CONCURRENTLY is not
-- permitted. These tables are small enough that a brief lock is fine. If you
-- ever need to add one to a very large table with zero downtime, run
-- CREATE INDEX CONCURRENTLY from a direct psql connection instead.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- MEDIA — the big one.
--
-- Target scale is 100,000 images. This is by far the largest table and it is
-- read on EVERY homepage load. Without a matching index, every visitor causes a
-- full sort of 100k rows.
-- ----------------------------------------------------------------------------
create index if not exists idx_media_salon_sort
  on media (salon_id, sort_order, id);

-- The gallery and the hero carousel are separate views of this table, and each
-- filters before sorting. Partial indexes keep them small and let Postgres skip
-- the rows it will discard anyway.
create index if not exists idx_media_gallery
  on media (salon_id, sort_order)
  where show_in_gallery;

create index if not exists idx_media_carousel
  on media (salon_id, sort_order)
  where show_in_carousel;

-- ----------------------------------------------------------------------------
-- APPOINTMENTS — the hot transactional table.
--
-- idx_appt_salon_date already exists on (salon_id, appt_date). Extending it
-- with `id` makes it cover the paginated read exactly, so page 2 does not
-- re-sort what page 1 already sorted.
-- ----------------------------------------------------------------------------
create index if not exists idx_appt_salon_date_id
  on appointments (salon_id, appt_date, id);

-- The agenda's daily and weekly views filter by a date RANGE and then order by
-- time. This serves both without a sort.
create index if not exists idx_appt_salon_date_time
  on appointments (salon_id, appt_date, appt_time);

-- Availability only ever cares about appointments that still hold their slot.
-- Cancelled ones are dead weight; excluding them keeps this index permanently
-- small even as cancellation history accumulates. It mirrors the partial unique
-- index uq_appt_slot exactly.
create index if not exists idx_appt_active_slots
  on appointments (salon_id, appt_date, appt_time)
  where status <> 'cancelled';

-- ----------------------------------------------------------------------------
-- CLIENTS
-- (salon_id, whatsapp) is already UNIQUE, so the booking upsert is covered.
-- This one serves the paginated ORDER BY id read.
-- ----------------------------------------------------------------------------
create index if not exists idx_clients_salon_id
  on clients (salon_id, id);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS
--
-- The admin panel renders these newest-first. Sorting in SQL (rather than in
-- JS, as the app does today) becomes worthwhile the moment this table is large,
-- and this index is what makes that possible without a rewrite.
-- ----------------------------------------------------------------------------
create index if not exists idx_notifications_salon_created
  on notifications (salon_id, created_at desc);

-- The unread badge is a COUNT over a tiny subset. A partial index means that
-- count never scans the read ones — which are the overwhelming majority.
create index if not exists idx_notifications_unread
  on notifications (salon_id)
  where unread;

-- ----------------------------------------------------------------------------
-- SERVICES / COURSES / STAFF — small tables, but read on every homepage hit.
-- ----------------------------------------------------------------------------
create index if not exists idx_services_salon_sort
  on services (salon_id, sort_order, id);

create index if not exists idx_courses_salon_sort
  on courses (salon_id, sort_order, id);

create index if not exists idx_staff_salon_sort
  on staff (salon_id, sort_order, id);

-- Only active rows are ever shown publicly.
create index if not exists idx_services_active
  on services (salon_id, sort_order)
  where active;

-- ----------------------------------------------------------------------------
-- PROMOTIONS / POSTS / COURSE REGISTRATIONS — small, ordered by id.
-- ----------------------------------------------------------------------------
create index if not exists idx_promotions_salon_id
  on promotions (salon_id, id);

create index if not exists idx_posts_salon_id
  on posts (salon_id, id);

create index if not exists idx_courseregs_salon_id
  on course_registrations (salon_id, id);

-- Looking up who registered for a given course.
create index if not exists idx_courseregs_course
  on course_registrations (course_id);

-- ----------------------------------------------------------------------------
-- CLIENT PHOTOS
-- idx_client_photos_client on (client_id) already exists and serves the profile
-- screen. This serves the paginated read.
-- ----------------------------------------------------------------------------
create index if not exists idx_client_photos_salon_id
  on client_photos (salon_id, id);

-- ============================================================================
-- Verify (optional). Should list every index above:
--
--   select tablename, indexname from pg_indexes
--    where schemaname = 'public'
--    order by tablename, indexname;
--
-- And confirm a query uses one rather than sorting:
--
--   explain analyze
--   select * from media where salon_id = '<your-salon-uuid>'
--    order by sort_order, id limit 1000;
--
-- Look for "Index Scan using idx_media_salon_sort". If you see "Seq Scan"
-- followed by "Sort", the index is not being used — check the salon_id type.
-- ============================================================================

insert into schema_migrations (version) values ('003_indexes')
  on conflict (version) do nothing;
