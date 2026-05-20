-- =====================================================================
-- email_logs.gmail_message_id — enables Gmail deletion sync
--
-- The Gmail-watch webhook now also processes messageDeleted and INBOX
-- labelRemoved history events. To dismiss the right email_logs row when
-- a staff member deletes / trashes / archives an email in Gmail, each
-- logged row needs the per-message Gmail id.
--
-- Gmail message ids are unique within a single mailbox, so matching on
-- this column alone resolves to the correct row. Only inbound emails
-- logged AFTER this migration carry the id — existing rows stay NULL
-- and are not deletion-synced.
--
-- Idempotent: safe to re-run.
-- =====================================================================

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS gmail_message_id text;

CREATE INDEX IF NOT EXISTS email_logs_gmail_message_id_idx
  ON public.email_logs (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

COMMENT ON COLUMN public.email_logs.gmail_message_id IS
  'Gmail message id of the inbound email this row was logged from. Unique within a mailbox. Used by the Gmail-watch webhook to dismiss the row when the message is deleted/trashed/archived in Gmail. NULL for outbound mail and for rows logged before this column existed.';
