-- =====================================================================
-- 20260611_invoice_description.sql
-- MAIA-read "what the invoice is FOR" summary (e.g. "2 units roof leaks"),
-- extracted from the invoice body. Shown on the intake editor for review/approve
-- and surfaced as the reconciliation Description for MAIA-pushed invoices.
-- Idempotent.
-- =====================================================================
ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS extracted_description text;
NOTIFY pgrst, 'reload schema';
