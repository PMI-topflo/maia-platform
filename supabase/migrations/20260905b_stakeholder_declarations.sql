-- =====================================================================
-- 20260905b_stakeholder_declarations.sql
--
-- User direction, 2026-09-05: the vehicle ("do you keep a vehicle at the
-- unit?") and tax-returns ("do you have 2 years of U.S. tax returns?",
-- purchase-only) declarations were each a SINGLE shared answer for the
-- whole application (listing_applications.declarations.vehicle/.taxReturns
-- -- lib/intake-documents.ts) even though the documents they gate
-- (car_registration, vehicle_insurance; intl_police_clearance etc.) are
-- already configured per_applicant -- one applicant's "yes" opened a
-- waiting checklist row for every co-applicant, including ones who'd
-- answer "no", with no way to tell them apart.
--
-- Adds nullable per-stakeholder columns so each applicant/buyer answers
-- their own vehicle and tax-returns question. The existing shared
-- declarations.vehicle/.taxReturns columns are left untouched for
-- back-compat reads of already-answered legacy applications (see
-- lib/intake-documents.ts's stakeholderDeclarationAnswer(), which falls
-- back to the shared value only for the primary stakeholder).
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS vehicle_has boolean;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS vehicle_declared_at timestamptz;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS tax_returns_has boolean;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS tax_returns_declared_at timestamptz;

NOTIFY pgrst, 'reload schema';
