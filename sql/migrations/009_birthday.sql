-- 009_birthday.sql
-- Tracks the last year a birthday greeting was sent, so the daily job never
-- double-greets a client. Birthdays themselves already live in clients.birthday.
-- Run in Supabase SQL editor BEFORE deploying v34+.

alter table clients
  add column if not exists last_birthday_greeted_year integer;
