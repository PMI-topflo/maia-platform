-- =====================================================================
-- 20260903b_manxi_tenant_affidavit_required_addl_occupant.sql
--
-- User correction on the generated Application Guide PDF, 2026-09-03:
-- "Tenant Affidavit (signed & notarized by tenant and landlord) - is
-- Req. for additional occupant" — the guide showed it required only for
-- lease, with additional_occupant blank ("—"), because no row existed
-- for that (association_code, application_type, doc_key) combination.
--
-- Copies the existing MANXI/lease/tenant_affidavit row's label, provided_by,
-- note, sort_order, template_path, requires_notarization, per_applicant and
-- allow_multiple verbatim onto a new additional_occupant row, so the two
-- stay in sync in both wording and notarization behavior — rather than
-- retyping them by hand and risking drift.
--
-- Idempotent (ON CONFLICT DO UPDATE forces required=true either way, even
-- if a not-required row already exists from some earlier state).
-- =====================================================================

INSERT INTO public.association_intake_documents
  (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, template_path, requires_notarization, per_applicant, allow_multiple, condition_key, created_by)
SELECT association_code, 'additional_occupant', doc_key, label, provided_by, true, note, sort_order, template_path, requires_notarization, per_applicant, allow_multiple, condition_key, 'maia_seed_20260903b_tenant_affidavit_addl_occupant'
  FROM public.association_intake_documents
 WHERE association_code = 'MANXI' AND application_type = 'lease' AND doc_key = 'tenant_affidavit'
ON CONFLICT (association_code, application_type, doc_key)
  DO UPDATE SET required = true, updated_at = now();

NOTIFY pgrst, 'reload schema';
