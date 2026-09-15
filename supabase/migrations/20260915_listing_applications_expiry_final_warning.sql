-- =====================================================================
-- 20260915_listing_applications_expiry_final_warning.sql
-- Lease-renewal expiry: the 24-hour final warning to owner + tenant
-- ("your renewal application expires in 24 hours; staying without an
-- approved renewal is a violation") is sent once and stamped here, and
-- the expiry itself then follows 24 hours later. User direction 2026-09-15.
-- Idempotent.
-- =====================================================================
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS expiry_final_warned_at timestamptz;
NOTIFY pgrst, 'reload schema';
