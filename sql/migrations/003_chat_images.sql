-- 003_chat_images.sql
-- Adds image attachment support to the site chat.
-- Run this in the Supabase SQL editor BEFORE deploying v27+.

alter table chat_messages
  add column if not exists image_url text;
