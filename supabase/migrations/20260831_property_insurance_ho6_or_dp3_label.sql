-- =====================================================================
-- 20260831_property_insurance_ho6_or_dp3_label.sql
--
-- "HO6 Property Insurance" → "HO6 Property Insurance or DP-3 (when rented)"
-- (user direction, 2026-08-31).
--
-- Real case: a Citizens "Dwelling Fire DP-3 Unit Owners Special Form"
-- policy (MANXI unit 912) was filed under this checklist item — it carries
-- the same essential coverages an HO-6 does (Condominium Unit Owners
-- Coverage, personal property, personal liability), and DP-3 is a common,
-- legitimate substitute for a unit that is rented out. This item only
-- appears on lease / lease_renewal / additional_occupant (see
-- 20260816_unit_owner_insurance.sql) — i.e. exactly the rented-unit case —
-- so the label now says so directly instead of naming HO-6 only, which
-- could read as rejecting a valid DP-3 filing. The upload/read logic
-- already accepts both by coverage (lib/document-validation.ts,
-- lib/insurance-analysis.ts, lib/insurance-declaration-extraction.ts);
-- this migration only updates the display label already-filed documents
-- stay attached to (doc_key is unchanged).
--
-- Scoped to rows whose label is still the exact current text, so a label
-- edited by hand in Association document setup is never overwritten.
-- Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET label = 'HO6 Property Insurance or DP-3 (when rented)', updated_at = now()
 WHERE doc_key = 'property_insurance'
   AND label = 'HO6 Property Insurance';

NOTIFY pgrst, 'reload schema';
