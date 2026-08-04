-- =====================================================================
-- 20260805_screening_provider_switch.sql
--
-- Per-association screening provider (B4 slice 3b, hybrid rollout): where an
-- approved Pre-Application intake hands off for the actual background check.
--   'tenant_evaluation' — the CURRENT external screening system (default)
--   'maia_checkr'       — MAIA's own applications + Checkr pipeline
-- MANXI stays on tenant_evaluation until Checkr is production-authorized; flip
-- this one value to switch. Idempotent.
-- =====================================================================

ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS screening_provider text NOT NULL DEFAULT 'tenant_evaluation';
ALTER TABLE public.associations DROP CONSTRAINT IF EXISTS chk_screening_provider;
ALTER TABLE public.associations ADD CONSTRAINT chk_screening_provider CHECK (screening_provider IN ('tenant_evaluation','maia_checkr'));

NOTIFY pgrst, 'reload schema';
