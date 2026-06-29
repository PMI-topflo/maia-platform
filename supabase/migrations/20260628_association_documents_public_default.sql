-- =====================================================================
-- 20260628_association_documents_public_default.sql
--
-- Board decision: association documents should be PUBLIC by default. New
-- uploads are public unless a staff member marks them private, and every
-- existing document is flipped public. Staff can still privatize sensitive
-- files (financials, leases, etc.) per document via the admin toggle.
-- Idempotent.
-- =====================================================================

ALTER TABLE public.association_documents
  ALTER COLUMN is_public SET DEFAULT true;

UPDATE public.association_documents
  SET is_public = true
  WHERE is_public = false;

NOTIFY pgrst, 'reload schema';
