-- =====================================================================
-- 20260805_lease_packet_contact_fields.sql
--
-- Lease-Packet Agreement field wiring. The Landlord–Tenant Agreement PDF
-- already renders "Property Address", "Owner Mobile" and "Primary Tenant
-- Mobile" fields, but they showed "—" because the packet never captured
-- them at send time. Snapshot them onto the packet row (like every other
-- field) so the signed document is self-contained and immutable:
--
--   owner_mobile     — the owner's phone from CINC (owners.phone)
--   tenant_mobile    — the tenant's phone (unit_tenant_contacts.tenant_phone)
--   property_address — composed from the association's principal address
--                      + the unit number at send time
--
-- These also supply the phone number the verified-signature phone factor
-- (next milestone) needs. ADD COLUMN IF NOT EXISTS is instant + idempotent.
-- =====================================================================

ALTER TABLE public.lease_packets ADD COLUMN IF NOT EXISTS owner_mobile     text;
ALTER TABLE public.lease_packets ADD COLUMN IF NOT EXISTS tenant_mobile    text;
ALTER TABLE public.lease_packets ADD COLUMN IF NOT EXISTS property_address text;

NOTIFY pgrst, 'reload schema';
