-- =====================================================================
-- 20260605_invoice_intake_per_attachment_uniq.sql
--
-- BUG FIX: a multi-PDF email created only ONE invoice draft.
--
-- The original dedupe key was a partial UNIQUE index on
-- gmail_message_id ALONE (invoice_intake_drafts_gmail_msg_uniq). But
-- handleInvoiceIntake inserts one row PER attachment, all carrying the
-- same gmail_message_id — so the first PDF inserted and every later PDF
-- on the same email hit 23505 and was silently swallowed as "skipped".
--
-- Fix: dedupe per (gmail_message_id, gmail_attachment_id) instead, so
-- one email with N PDFs yields N drafts, while Pub/Sub redeliveries (and
-- manual reprocess) still can't create a duplicate of an attachment that
-- already has a draft.
--
-- Legacy rows (created before this migration) have a NULL
-- gmail_attachment_id; coalesce('') keeps them unique by message id,
-- matching the old behavior, so this is safe to apply over live data.
--
-- Idempotent: add-column-if-not-exists + drop/recreate the index.
-- =====================================================================

ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS gmail_attachment_id text;

-- Drop the per-email unique index (the bug) and replace it with a
-- per-attachment one. coalesce(...,'') makes the NULL-attachment legacy
-- rows behave like the old one-row-per-message rule.
DROP INDEX IF EXISTS public.invoice_intake_drafts_gmail_msg_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_intake_drafts_gmail_msg_att_uniq
  ON public.invoice_intake_drafts (gmail_message_id, coalesce(gmail_attachment_id, ''))
  WHERE gmail_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
