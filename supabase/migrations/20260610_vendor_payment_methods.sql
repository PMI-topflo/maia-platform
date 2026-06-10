-- =====================================================================
-- 20260610_vendor_payment_methods.sql
--
-- Per-vendor payment method, learned by reading every paid invoice in CINC
-- over the last ~12 months (GET /management/associations/1/invoices returns
-- PayByType + VendorID per row). Backfilled by an admin action and used to
-- pre-fill the payment method for ANY vendor — not just utilities, and
-- without waiting for a MAIA push. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vendor_payment_methods (
  cinc_vendor_id     text        PRIMARY KEY,
  vendor_name        text,
  pay_by_type        text,                 -- dominant method (e.g. ACH / EFT / Check)
  sample_count       int         NOT NULL DEFAULT 0,
  last_invoice_date  date,
  last_method        text,                 -- method on the most recent invoice
  updated_at         timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_payment_methods TO anon, authenticated, service_role;
ALTER TABLE public.vendor_payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_vendor_payment_methods" ON public.vendor_payment_methods;
CREATE POLICY "service_role_all_vendor_payment_methods"
  ON public.vendor_payment_methods FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
