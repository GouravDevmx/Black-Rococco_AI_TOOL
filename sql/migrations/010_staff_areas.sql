-- 010_staff_areas.sql
-- Specialist areas + multi-service visits.
--
--  staff.area        which body area a team member works: 'hands' | 'feet' | 'both'
--  services.area     which specialist performs a service (same values)
--  appointments.staff_id   who performs this appointment (nullable = unassigned)
--  appointments.group_id   bookings made together in one order share this id,
--                          so a manicure + pedicure booked at once can be shown
--                          and managed as a single visit
--
-- Existing rows get sensible defaults: staff default to 'both' (so nobody
-- silently loses availability), and services are inferred from their category
-- on first load (pedicure/pies -> feet, everything else -> hands).
-- Run in the Supabase SQL editor BEFORE deploying v39+.

alter table staff
  add column if not exists area text not null default 'both';

alter table services
  add column if not exists area text not null default 'hands';

alter table appointments
  add column if not exists staff_id text,
  add column if not exists group_id text;

create index if not exists appointments_group_id_idx on appointments (group_id);
