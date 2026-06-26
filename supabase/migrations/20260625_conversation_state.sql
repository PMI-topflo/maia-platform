-- =====================================================================
-- 20260625_conversation_state.sql
--
-- Per-phone conversation state for the SMS / WhatsApp / voice assistant
-- (app/api/webhook/route.ts). This table backs EVERY multi-step flow:
--   • the "ask which persona once" multi-role clarifier
--   • parking-sticker, maintenance, schedule, agent-identification flows
--   • feedback capture
--   • the language-switch mini-flow (current_flow = 'language_switch')
--
-- It was missing from the live DB (PostgREST PGRST205 — "table not found
-- in schema cache"), so getConversationState() always returned null and
-- every flow silently reset between turns: MAIA re-greeted on every inbound
-- and no guided flow could advance. This migration restores it.
--
-- Idempotent and safe whether the table is genuinely absent (it gets
-- created) or merely missing from PostgREST's cache (CREATE is a no-op and
-- the NOTIFY reloads the cache). Keyed/upserted on phone_number.
--
-- conversation_state is reached only through the service-role admin client
-- (getSupabase() in the webhook), so a service_role grant is sufficient.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.conversation_state (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number        text        NOT NULL UNIQUE,
  owner_id            text,
  current_flow        text        NOT NULL DEFAULT 'idle',
  current_step        text        NOT NULL DEFAULT 'idle',
  temporary_data_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
  session_language    text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- If the table already existed from an earlier hand-applied version that
-- predates the per-conversation language override, add the column.
ALTER TABLE public.conversation_state
  ADD COLUMN IF NOT EXISTS session_language text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_state TO service_role;

NOTIFY pgrst, 'reload schema';
