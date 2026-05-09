-- Classify each association's type by inferring from its registered name.
-- Florida Sunbiz entity names are highly consistent:
--   "X COOPERATIVE, INC." / "X CO-OPERATIVE, INC."
--   "X HOMEOWNERS ASSOCIATION, INC." / "X PROPERTY OWNERS ASSOCIATION"
--   "X CONDOMINIUM ASSOCIATION, INC." (default for unmatched residential condos)
--
-- Only rows where association_type IS NULL are touched, so any manual
-- classifications already entered through the admin UI are preserved.
-- Commercial-only condos are typically NOT identifiable from the name alone;
-- staff should review and flip any commercial buildings to 'commercial_condo'
-- via the admin UI or a follow-up UPDATE.

-- Cooperatives
UPDATE public.associations
   SET association_type = 'coop'
 WHERE association_type IS NULL
   AND (
     association_name ILIKE '%COOPERATIVE%'
     OR association_name ILIKE '%CO-OPERATIVE%'
     OR association_name ILIKE '% COOP %'
     OR association_name ILIKE '% COOP,%'
     OR association_name ILIKE '% COOP.%'
   );

-- HOAs
UPDATE public.associations
   SET association_type = 'hoa'
 WHERE association_type IS NULL
   AND (
     association_name ILIKE '%HOMEOWNERS ASSOCIATION%'
     OR association_name ILIKE '%HOMEOWNER ASSOCIATION%'
     OR association_name ILIKE '%HOMEOWNERS'' ASSOCIATION%'
     OR association_name ILIKE '%PROPERTY OWNERS ASSOCIATION%'
     OR association_name ILIKE '%PROPERTY OWNERS'' ASSOCIATION%'
     OR association_name ILIKE '%COMMUNITY ASSOCIATION%'
   );

-- Residential condos (catch-all for "CONDOMINIUM ASSOCIATION" not already classified)
UPDATE public.associations
   SET association_type = 'condo'
 WHERE association_type IS NULL
   AND association_name ILIKE '%CONDOMINIUM%';
