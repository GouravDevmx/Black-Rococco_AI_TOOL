-- 008_client_deposit.sql
-- "Deposit on file" flag: clients marked by the admin whose future
-- bookings are auto-confirmed (skip the pending-deposit state).
-- Run in Supabase SQL editor BEFORE deploying v31+.

alter table clients
  add column if not exists deposit_on_file boolean not null default false;
