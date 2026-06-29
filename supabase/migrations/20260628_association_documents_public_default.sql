-- =====================================================================
-- 20260628_association_documents_public_default.sql
--
-- Board decision: association documents are PUBLIC by default — EXCEPT the
-- sensitive categories (financials, budget, leases & resale), which stay
-- private and are only reachable after a tenant/buyer/agent starts their
-- registration or an owner logs in. New uploads default public; staff can
-- still privatize any document. Idempotent.
-- =====================================================================

ALTER TABLE public.association_documents
  ALTER COLUMN is_public SET DEFAULT true;

-- Flip everything public EXCEPT the sensitive categories.
UPDATE public.association_documents
  SET is_public = true
  WHERE is_public = false
    AND category NOT IN ('financials', 'budget', 'leases_resale');

-- Keep sensitive categories private even if previously flagged public.
UPDATE public.association_documents
  SET is_public = false
  WHERE category IN ('financials', 'budget', 'leases_resale');

NOTIFY pgrst, 'reload schema';
