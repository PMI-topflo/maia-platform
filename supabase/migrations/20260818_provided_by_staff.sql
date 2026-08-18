-- =====================================================================
-- 20260818_provided_by_staff.sql
--
-- Background / Credit Reports was configured provided_by = 'applicant',
-- which let it leak into a resident-facing ask (the standard-reply feature's
-- self-serve upload link). It is not something a tenant can produce — it
-- comes from Tenant Evaluation or Checkr, obtained and uploaded by staff.
-- User direction, 2026-08-18: "it will be with me now to upload."
--
-- 'staff' is a new, fourth meaning for provided_by: nobody EXTERNAL is ever
-- asked for this item — not the owner, not the tenant, not an agent. It is
-- structurally different from 'landlord' (which still means "ask the
-- owner") and from the existing exclusion logic for esign-backed items
-- (which redirects the ask to a form instead of a file) — this is the first
-- provided_by value that means "there is no ask; only staff files this."
--
-- Also widens the CHECK constraint to include 'both', which is already live
-- in production (3 rows) despite never appearing in a committed migration —
-- drift from a hand-run ALTER. Restating it here so the constraint in the
-- database matches what the data has actually contained for a while.
-- =====================================================================

ALTER TABLE public.association_intake_documents DROP CONSTRAINT IF EXISTS chk_intake_provider;
ALTER TABLE public.association_intake_documents
  ADD CONSTRAINT chk_intake_provider CHECK (provided_by IN ('applicant','landlord','agent','both','staff'));

UPDATE public.association_intake_documents
   SET provided_by = 'staff', updated_at = now()
 WHERE doc_key = 'background_credit' AND provided_by = 'applicant';

NOTIFY pgrst, 'reload schema';
