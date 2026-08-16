-- =====================================================================
-- 20260816_unit_owner_insurance.sql
--
-- The UNIT OWNER's insurance, required on every association that has units
-- whose interior the master policy does not cover.
--
-- Uses the EXISTING doc_key 'property_insurance' (already in use at MANXI as
-- "Proof of HO-6 Insurance Policy") rather than a new key, so the documents
-- already filed under it stay attached to the item.
--
-- WHO GETS IT, AND WHY (confirmed per association, 2026-08-16 — not inferred):
--
--   condo (15) + coop (1)   → required. The master policy covers the building;
--                             the owner covers the interior. HO-6.
--   hoa GVH, PVV            → required. Confirmed with the user: the
--                             association policy does NOT cover the inside of
--                             the units, and the units are attached to their
--                             neighbours — so a loss travels between homes and
--                             the owner's own policy is what answers for the
--                             interior.
--   hoa BHB                 → NOT required. Single-family homes; no shared
--                             structure and no association coverage of the
--                             interior to sit behind.
--   master_hoa LCLUB, VPREC → NOT required. No units.
--   commercial_condo (5)    → NOT SEEDED YET. ESSI, KANE, MACO, WBP, WBPA need
--                             a commercial form (CP 00 17 / BOP), not HO-6, and
--                             the exact form is pending confirmation. Asking a
--                             commercial owner for an HO-6 would just confuse
--                             them, so they are deliberately left out rather
--                             than given a wrong requirement.
--
-- Not on PURCHASE: a buyer supplies a QUOTE with the application and the issued
-- policy after closing, which MANXI already models as its own 'ho6_quote' item.
-- This is the in-force policy for an occupied unit.
-- =====================================================================

INSERT INTO public.association_intake_documents
  (association_code, application_type, doc_key, label, provided_by, required, note, sort_order, created_by)
SELECT a.association_code, t.application_type, 'property_insurance',
       CASE a.association_type
         WHEN 'coop' THEN 'Proof of Unit Insurance (co-op shareholder policy)'
         WHEN 'hoa'  THEN 'Proof of Unit Owner''s Insurance'
         ELSE 'Proof of HO-6 Insurance Policy'
       END,
       'landlord', true,
       CASE a.association_type
         WHEN 'hoa' THEN 'The Association''s policy does not cover the inside of the unit, and the units are attached — the owner''s own policy covers the interior.'
         ELSE 'The owner''s unit policy, not the tenant''s renters insurance.'
       END,
       75, 'maia_seed_20260816'
  FROM public.associations a
 CROSS JOIN (VALUES ('lease'),('lease_renewal'),('additional_occupant')) AS t(application_type)
 WHERE a.association_type IN ('condo','coop')
    OR a.association_code IN ('GVH','PVV')
ON CONFLICT (association_code, application_type, doc_key) DO UPDATE
  SET required = true, active = true, updated_at = now();

NOTIFY pgrst, 'reload schema';
