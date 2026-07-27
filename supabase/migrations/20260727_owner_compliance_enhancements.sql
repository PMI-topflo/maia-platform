-- =====================================================================
-- 20260727_owner_compliance_enhancements.sql
--
-- Owner self-service page (/owner/compliance/<token>) enhancements:
--   1. unit_tenant_contacts.occupants jsonb — additional occupants beyond
--      the primary tenant ([{name,phone,email}]); the primary tenant still
--      lives in the existing tenant_name/phone/email columns for back-compat.
--   2. owner_compliance_requests.contact_confirmed_at — when the owner
--      confirmed their name/email/phone on file are correct.
--   3. owner_compliance_requests.contact_change_request — free-text change
--      the owner requested to their contact info (staff review).
--   4. owner_compliance_requests.emergency_contact jsonb — the unit's
--      emergency contact ({name,phone,email}) entered as fields, not a file.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.unit_tenant_contacts
  ADD COLUMN IF NOT EXISTS occupants jsonb;

ALTER TABLE public.owner_compliance_requests
  ADD COLUMN IF NOT EXISTS contact_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS contact_change_request text,
  ADD COLUMN IF NOT EXISTS emergency_contact      jsonb;

NOTIFY pgrst, 'reload schema';
