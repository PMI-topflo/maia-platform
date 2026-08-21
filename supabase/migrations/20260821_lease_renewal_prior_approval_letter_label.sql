-- =====================================================================
-- 20260821_lease_renewal_prior_approval_letter_label.sql
--
-- MANXI lease_renewal's `board_approval_letter` checklist item read as a
-- bare "Board Approval Letter" — indistinguishable, out of context, from
-- the NEW letter MAIA itself generates once the board approves THIS
-- renewal. It's actually optional supporting documentation: the PRIOR
-- letter from when the tenancy was first approved, if the owner happens to
-- have it on hand. User report, 2026-08-21 (MANXI 110, Susie Bell renewal,
-- owner Monica Blumenfeld): "let's make it clear when Lease Renewal on the
-- request, change for Copy of Last Year's Approval Letter."
--
-- Relabeled + given the clarifier the `lease` type's own row already has
-- (adapted for "prior", not "the" approval). Unaffected: required=false,
-- provided_by='landlord', doc_key itself (still board_approval_letter, so
-- any already-uploaded document stays filed under it).
--
-- Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET label = 'Copy of Last Year''s Approval Letter',
       note = 'Optional — the board approval letter from when this tenancy was last approved, if you have it on hand (from the Drive folder or uploaded).',
       updated_at = now()
 WHERE association_code = 'MANXI' AND application_type = 'lease_renewal' AND doc_key = 'board_approval_letter';

NOTIFY pgrst, 'reload schema';
