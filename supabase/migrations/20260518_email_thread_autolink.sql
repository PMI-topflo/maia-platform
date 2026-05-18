-- =====================================================================
-- email thread auto-link — extend email_logs + communication_ticket_links
-- with gmail_thread_id so future replies in a linked thread can auto-
-- attach to the same ticket without staff re-linking each message.
--
-- Flow after this migration is applied:
--
--   1. Inbound email arrives, logEmail() records it with gmail_thread_id.
--   2. logEmail() then checks communication_ticket_links for any
--      existing link with the same gmail_thread_id (type='email').
--   3. For every matching ticket, a fresh link row is inserted pointing
--      to the new email — system-attributed (linked_by_email='system').
-- =====================================================================

ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS gmail_thread_id text;

CREATE INDEX IF NOT EXISTS email_logs_thread_idx
  ON public.email_logs (gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;

ALTER TABLE public.communication_ticket_links
  ADD COLUMN IF NOT EXISTS gmail_thread_id text;

CREATE INDEX IF NOT EXISTS ctl_thread_idx
  ON public.communication_ticket_links (gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;

COMMENT ON COLUMN public.email_logs.gmail_thread_id IS
  'Gmail threadId for the conversation this email belongs to. Populated by the Pub/Sub webhook for inbound mail and by callers of logEmail() that have a thread context (e.g. staff replies via the ticket dashboard).';

COMMENT ON COLUMN public.communication_ticket_links.gmail_thread_id IS
  'Captured at link time from the source email_logs row. Used by logEmail() to auto-link future messages in the same Gmail thread to the same ticket(s).';
