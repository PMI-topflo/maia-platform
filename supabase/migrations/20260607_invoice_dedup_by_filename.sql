-- =====================================================================
-- 20260607_invoice_dedup_by_filename.sql
--
-- BUG FIX: invoice intake created MASSIVE duplicate drafts (one invoice
-- drafted 88×) during the 2026-06-07 webhook recovery.
--
-- Root cause: the per-attachment dedup key was (gmail_message_id,
-- gmail_attachment_id). But Gmail's attachmentId is NOT stable — it
-- returns a DIFFERENT value on every messages.get. So each reprocess of
-- the same email looked like a brand-new attachment, slipped past the
-- dedup, and inserted a fresh draft (and burned a Claude extraction call).
--
-- Fix: dedup on the STABLE attachment FILENAME instead. Add
-- attachment_filename, and enforce uniqueness on (gmail_message_id,
-- attachment_filename) for rows that have it. Partial (WHERE NOT NULL) so
-- pre-existing rows (attachment_filename = NULL, possibly several per
-- message after the dup incident) don't collide and block the index.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS attachment_filename text;

-- Retire the volatile-attachmentId index (it never matched, so it allowed
-- the duplicates) and replace it with the stable filename key.
DROP INDEX IF EXISTS public.invoice_intake_drafts_gmail_msg_att_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_intake_drafts_msg_filename_uniq
  ON public.invoice_intake_drafts (gmail_message_id, attachment_filename)
  WHERE attachment_filename IS NOT NULL;

NOTIFY pgrst, 'reload schema';
