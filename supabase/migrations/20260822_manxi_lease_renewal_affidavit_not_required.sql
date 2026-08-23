-- =====================================================================
-- 20260822_manxi_lease_renewal_affidavit_not_required.sql
--
-- User report, unit 1002 (Ester Rodao/Julian Osorio renewal): "Why is
-- asking the Affidavit if it's a lease renewal?"
--
-- Found direct, on-the-record confirmation this was already answered once,
-- on this exact unit, 2026-08-01: on-site manager Kaye Brunson (LCAM) told
-- staff "You are right for lease renewal, the affidavit is not needed
-- again. Please disregard the affidavit for this matter," after staff
-- asked "Why the affidavit again if we have it on the initial
-- application?"
--
-- Checked usage since: every tenant_affidavit ever filed on a MANXI
-- lease_renewal application (5, across 9 renewals) came in via
-- uploaded_by_role='drive-pick' or 'staff' — staff backfilling it from the
-- ORIGINAL lease's file, never a fresh applicant/notary response to the
-- renewal's own intake ask.
--
-- NOT deactivated (unlike this session's board_approval_letter
-- retirements) — it's a real document type that occasionally IS still
-- missing and worth asking for; just no longer required, so it can't block
-- completion on a renewal the way it did here.
--
-- Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET required = false, updated_at = now()
 WHERE association_code = 'MANXI' AND application_type = 'lease_renewal' AND doc_key = 'tenant_affidavit';

NOTIFY pgrst, 'reload schema';
