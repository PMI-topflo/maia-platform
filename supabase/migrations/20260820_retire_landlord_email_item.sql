-- =====================================================================
-- 20260820_retire_landlord_email_item.sql
--
-- Retire MANXI lease's `landlord_email` checklist item (user direction,
-- 2026-08-20, surfaced by a real "missing document" report on unit 912).
--
-- Seeded 2026-08-05 as a REQUIRED, applicant-provided item labeled
-- "Landlord's Email" — but it was configured like an uploadable document
-- (the same shape as "Driver's License" or "Vehicle Registration") when its
-- content is just an email address, with no physical file a tenant could
-- ever upload to satisfy it. MAIA already has the real owner's email on
-- file in `owners` whenever one exists (confirmed live: MANXI 912's owner,
-- Carmen Robinson, jk.robin17@gmail.com — already the recipient
-- document_requests uses) — a separate checklist requirement asking the
-- TENANT to somehow supply it is both redundant and structurally unfillable.
-- Every MANXI lease application was permanently missing this one item.
--
-- Soft-deactivated (active = false), same mechanism already used to retire
-- MANXI's ad-hoc pet_esa_documents item — getIntakeChecklist() (and the
-- RLS public-read policy) both filter on active = true, so this disappears
-- from every screen without deleting the row or any already-uploaded
-- application_documents rows against this doc_key (there are none live, but
-- the mechanism preserves anything that existed).
--
-- Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET active = false, updated_at = now()
 WHERE association_code = 'MANXI' AND application_type = 'lease' AND doc_key = 'landlord_email';

NOTIFY pgrst, 'reload schema';
