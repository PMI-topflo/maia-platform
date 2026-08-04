-- =====================================================================
-- 20260805_preapply_email_verified.sql
--
-- Applicants must verify their email (OTP) before they can upload documents on
-- the public Pre-Application intake — so the "who" on the intake is confirmed,
-- not just self-declared. This stamps when they passed the code check.
-- ADD COLUMN IF NOT EXISTS is instant + idempotent.
-- =====================================================================

ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

NOTIFY pgrst, 'reload schema';
