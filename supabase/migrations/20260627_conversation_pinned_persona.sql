-- =====================================================================
-- 20260627_conversation_pinned_persona.sql
--
-- Pin the persona a multi-role contact chose, so the "which hat?" greeting
-- fires ONCE per conversation instead of re-greeting on every idle message.
-- Survives flow transitions (save/clearConversationState never touch it),
-- mirroring session_language. Cleared on an explicit greeting ("menu"/"hi").
-- conversation_state is an existing table — legacy grants apply. Idempotent.
-- =====================================================================

ALTER TABLE public.conversation_state
  ADD COLUMN IF NOT EXISTS pinned_persona text;

NOTIFY pgrst, 'reload schema';
