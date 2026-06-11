-- =====================================================================
-- 20260611_invoice_wo_partial.sql
-- A partial / downpayment invoice should NOT auto-close its linked work order.
-- When false (default) a pushed invoice closes the WO as paid; when true it
-- just records the downpayment and leaves the WO open for the balance. Idempotent.
-- =====================================================================
ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS wo_partial_payment boolean NOT NULL DEFAULT false;
NOTIFY pgrst, 'reload schema';
