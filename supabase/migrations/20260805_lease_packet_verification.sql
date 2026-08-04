-- =====================================================================
-- 20260805_lease_packet_verification.sql
--
-- Verified-signature layer for lease-packet e-signatures. Before a signer's
-- electronic signature is recorded, their identity is verified with
-- multi-factor checks, captured here per role as a JSON "verification
-- certificate":
--   email OTP (always), phone OTP via SMS or WhatsApp (when a mobile is on
--   file), geolocation + device (browser consent, IP fallback).
-- Rendered on the signed PDF and retained as the audit trail. ADD COLUMN
-- IF NOT EXISTS is instant + idempotent.
-- =====================================================================

ALTER TABLE public.lease_packets ADD COLUMN IF NOT EXISTS owner_verification  jsonb;
ALTER TABLE public.lease_packets ADD COLUMN IF NOT EXISTS tenant_verification jsonb;

NOTIFY pgrst, 'reload schema';
