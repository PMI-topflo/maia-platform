-- Authoritative classification of all 25 PMI-managed associations,
-- per the property manager's master list.
--
-- Adds 'master_hoa' as a fifth allowed type for umbrella associations
-- that govern community-wide common areas across multiple sub-associations
-- (still under FS 720, but operating one level above unit-level associations).
--
-- This migration explicitly SETS every code, overriding any value set by
-- the earlier name-pattern classifier or commercial-condo flagging.

ALTER TABLE public.associations
  DROP CONSTRAINT IF EXISTS associations_association_type_check;

ALTER TABLE public.associations
  ADD CONSTRAINT associations_association_type_check
  CHECK (association_type IN ('condo', 'coop', 'hoa', 'commercial_condo', 'master_hoa'));

-- Commercial condos
UPDATE public.associations SET association_type = 'commercial_condo'
  WHERE association_code IN ('KANE', 'WBP', 'WBPA', 'MACO', 'ESSI');

-- Co-ops
UPDATE public.associations SET association_type = 'coop'
  WHERE association_code IN ('LFA');

-- Standard HOAs
UPDATE public.associations SET association_type = 'hoa'
  WHERE association_code IN ('PVV', 'BHB', 'GVH');

-- Master HOAs (umbrella over sub-associations)
UPDATE public.associations SET association_type = 'master_hoa'
  WHERE association_code IN ('VPREC', 'LCLUB');

-- Residential condo associations
UPDATE public.associations SET association_type = 'condo'
  WHERE association_code IN (
    'SP', 'KGA', 'GK7', 'MANXI', 'SHORE', 'ONE',
    'VPCII', 'CHV', 'VPCI', 'VPC5', 'FIFTH',
    'ABBOTT', 'ISLAND', 'DELA'
  );
