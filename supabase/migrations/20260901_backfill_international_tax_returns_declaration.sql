-- =====================================================================
-- 20260901_backfill_international_tax_returns_declaration.sql
--
-- User direction, 2026-09-01: the 'international' condition_key checklist
-- items (intl_police_clearance, intl_cpa_certification, intl_translation --
-- see 20260828_manxi_international_applicant_docs.sql) only retire once
-- declarations.taxReturns.has is explicitly answered (lib/intake-
-- documents.ts declaredNaKeys/activeConditions). That question is asked at
-- the START of the pre-apply intake form (app/pre-apply/[code]/page.tsx),
-- so any MANXI purchase application STARTED before this feature shipped
-- (2026-08-28) never saw it -- declarations.taxReturns stays unset forever,
-- permanently gating Foreign Police Clearance / CPA Financial Certification
-- as still outstanding even for an applicant who already provided 2 years
-- of U.S. tax returns (direct proof they don't need them). Real case,
-- 2026-09-01: Wilner Florestan's Request-the-missing-documents panel still
-- listed both as "missing" though his Last 2 Years' Tax Returns document
-- was already on file and approved.
--
-- Backfills declarations.taxReturns = {has: true} for every OPEN MANXI
-- purchase application that has never answered this question but HAS a
-- tax_returns_2yr document on file -- direct evidence of U.S. tax history,
-- not a guess. An application with neither an answer nor a tax_returns_2yr
-- document is deliberately left untouched here (genuinely unknown -- could
-- be a real international buyer) and still needs the actual yes/no answer
-- from staff.
--
-- Idempotent: only touches rows where declarations->'taxReturns' is
-- currently absent.
-- =====================================================================

UPDATE public.listing_applications la
SET declarations = coalesce(la.declarations, '{}'::jsonb) ||
  jsonb_build_object('taxReturns', jsonb_build_object('has', true, 'at', now()))
WHERE la.association_code = 'MANXI'
  AND la.application_type = 'purchase'
  AND la.status IN ('started', 'submitted', 'under_review', 'approval_sent')
  AND (la.declarations -> 'taxReturns') IS NULL
  AND EXISTS (
    SELECT 1 FROM public.application_documents ad
    WHERE ad.application_id = la.id AND ad.doc_key = 'tax_returns_2yr'
  );
