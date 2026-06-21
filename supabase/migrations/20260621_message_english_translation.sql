-- =====================================================================
-- 20260621_message_english_translation.sql
--
-- Canonical-English history: residents communicate in many languages, but
-- staff dashboards + reports must read in English. We translate inbound
-- non-English messages at ingest (lib/translate.ts → Claude) and store the
-- English alongside the original. `body_en` is shown English-first in staff
-- views; the original `body` stays for "view original".
--
-- Columns on EXISTING tables → no new grants. Idempotent.
-- =====================================================================

ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS body_en text;          -- English translation (null = same as body / not translated)

ALTER TABLE public.general_conversations
  ADD COLUMN IF NOT EXISTS body_en text;

NOTIFY pgrst, 'reload schema';
