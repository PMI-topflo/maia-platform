-- =====================================================================
-- 20260821_retire_board_approval_letter_new_lease.sql
--
-- Retire MANXI's `board_approval_letter` checklist item on NEW leases
-- (application_type = 'lease'). User report, 2026-08-21: MANXI 912
-- (Querline Pinckney's first lease, owner Carmen Robinson) had MAIA
-- request a "Board Approval Letter" from the owner — nonsensical on a
-- brand-new tenancy, since there is no PRIOR board decision to reference
-- at all (unlike lease_renewal, fixed the same day, where "last year's
-- letter" at least makes sense).
--
-- Checked every board_approval_letter document ever filed on a MANXI
-- `lease` application (3, across 6 applications): every single one was
-- uploaded_by_role = 'drive-scan' on an application already `approved` —
-- i.e. MAIA's own Drive scan picking up THIS application's own signed
-- decision letter (lib/esign.ts files it under this exact doc_key on
-- signing) after the fact, never an owner responding to the intake ask.
-- The item has never once been genuinely fulfilled as an owner-supplied
-- document — it only ever "clears" by coincidence with the automatic
-- output of approval, which doesn't exist yet at intake time.
--
-- Soft-deactivated (active = false), same mechanism as the landlord_email
-- and pet_esa_documents retirements — getIntakeChecklist() and the RLS
-- public-read policy both filter on active = true, so it disappears
-- everywhere without deleting the row or any already-filed documents.
-- NOT touched here: lease_renewal (relabeled, not retired, same day —
-- "prior year's letter" is a real thing there), purchase,
-- additional_occupant — same underlying pattern likely applies to those
-- too, left for a follow-up since this report was specifically new-lease.
--
-- Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET active = false, updated_at = now()
 WHERE association_code = 'MANXI' AND application_type = 'lease' AND doc_key = 'board_approval_letter';

NOTIFY pgrst, 'reload schema';
