-- =====================================================================
-- 20260606_gmail_cooldown.sql
--
-- Gmail 429 self-healing cooldown. When the webhook hits a Gmail
-- "User-rate limit exceeded" (RESOURCE_EXHAUSTED) it reads the Retry-After
-- time and parks it here; until that time passes it ACKs Pub/Sub WITHOUT
-- calling Gmail at all — so the per-user quota gets a quiet window to reset
-- instead of being kept hot by every notification (the 2026-06-06 maia@
-- rate-limit stall). One column per account scope.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.maia_watch_state
  ADD COLUMN IF NOT EXISTS gmail_cooldown_until timestamptz;

ALTER TABLE public.staff_gmail_accounts
  ADD COLUMN IF NOT EXISTS gmail_cooldown_until timestamptz;

NOTIFY pgrst, 'reload schema';
