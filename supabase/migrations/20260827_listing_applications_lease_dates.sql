-- Real bug, 2026-08-27: MANXI unit 706's Landlord-Tenant Agreement packet
-- showed the PREVIOUS tenant's lease term (2024-06-01 - 2025-05-31, from
-- unit_tenant_contacts, which only refreshes on approval and was still
-- carrying the prior tenancy) instead of the new applicant's real term
-- (2026-08-21 - 2027-08-20, stated plainly on page 1 of the signed lease
-- they'd just uploaded). lib/lease-extract.ts already reads the correct
-- dates off the uploaded lease at intake time — they were just never saved
-- anywhere. These columns give the CURRENT application its own place to
-- hold that extracted term, so lib/lease-packet.ts can prefer it over the
-- unit-wide (and inherently laggy) unit_tenant_contacts fallback.
ALTER TABLE public.listing_applications
  ADD COLUMN IF NOT EXISTS lease_start date,
  ADD COLUMN IF NOT EXISTS lease_end date;
