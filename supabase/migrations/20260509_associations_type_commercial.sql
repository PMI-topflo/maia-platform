-- Allow 'commercial_condo' as a fourth association_type value.
-- Commercial condos are still governed by FS 718 but with different practical
-- considerations (business-to-business tone, sq-ft-weighted voting, ADA,
-- commercial leases, signage/hours/parking rules) — distinct enough to deserve
-- its own value so MAIA can route to the right guidance.

ALTER TABLE public.associations
  DROP CONSTRAINT IF EXISTS associations_association_type_check;

ALTER TABLE public.associations
  ADD CONSTRAINT associations_association_type_check
  CHECK (association_type IN ('condo', 'coop', 'hoa', 'commercial_condo'));
