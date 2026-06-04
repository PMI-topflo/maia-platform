-- =====================================================================
-- 20260604_invoice_on_hold.sql
--
-- Adds an "On Hold" state to the invoice intake flow. Some invoices can't
-- be processed until we collect missing vendor info (COI / license / W-9 /
-- ACH). Staff put the draft on hold, check off which documents they're
-- requesting, optionally create a follow-up ticket, and email the vendor a
-- tokenized upload link.
--
-- Idempotent: extends the status CHECK constraint + adds nullable columns.
-- =====================================================================

-- ── Extend the status constraint to allow 'on_hold' ──────────────────
ALTER TABLE public.invoice_intake_drafts DROP CONSTRAINT IF EXISTS invoice_intake_drafts_status_check;
ALTER TABLE public.invoice_intake_drafts
  ADD CONSTRAINT invoice_intake_drafts_status_check CHECK (status IN
    ('pending_review','ready_to_push','needs_vendor','duplicate_in_cinc','pushed_to_cinc','rejected','on_hold'));

-- ── Hold metadata ────────────────────────────────────────────────────
ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS hold_requested_items text[],          -- e.g. {'COI','License','W9','ACH'}
  ADD COLUMN IF NOT EXISTS hold_ticket_id        bigint,         -- follow-up ticket (tickets.id)
  ADD COLUMN IF NOT EXISTS hold_requested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hold_note             text;

NOTIFY pgrst, 'reload schema';
