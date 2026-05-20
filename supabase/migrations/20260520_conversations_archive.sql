-- =====================================================================
-- general_conversations soft-archive
--
-- Lets staff clean up the Communications conversations list (test data,
-- resolved noise) without destroying the record. Archived rows are
-- hidden from the default view but stay in the table and can be
-- restored from the "Show archived" toggle.
-- =====================================================================

ALTER TABLE public.general_conversations
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_email text;

-- Partial index keeps the default (non-archived) list fast.
CREATE INDEX IF NOT EXISTS general_conversations_active_idx
  ON public.general_conversations (updated_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.general_conversations.archived_at IS
  'When set, the conversation is hidden from the Communications view. Soft-delete — the row is preserved and can be restored.';
