-- 007_chat_identity.sql
-- Stores the logged-in client's WhatsApp on chat messages so the admin
-- can contact the person directly from the CRM.
-- Run in Supabase SQL editor BEFORE deploying v28+.

alter table chat_messages
  add column if not exists whatsapp text;
