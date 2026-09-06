-- =====================================================================
-- 20260906b_associations_default_maia_checkr.sql
--
-- User direction, 2026-09-06: "put all associations as Checkr as
-- default." lib/preapply.ts's createIntake() snapshots each NEW
-- application's screening_provider from its association's live value
-- at creation time -- flipping the column default here, plus updating
-- every existing row, means every application started from today
-- forward (any association, not just MANXI) goes straight to MAIA's
-- own Checkr pipeline instead of the old manual "Rentvine Screening"
-- process (DB value tenant_evaluation -- see
-- 20260805_screening_provider_switch.sql and lib/preapply.ts's
-- resolveScreeningProvider doc comment for the full history).
--
-- Applications already in flight are UNAFFECTED -- resolveScreeningProvider
-- always reads an application's own frozen snapshot, never a live
-- associations lookup, so one already running on tenant_evaluation stays
-- there exactly as before. Only where an application starts fresh after
-- this runs does it matter.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.associations ALTER COLUMN screening_provider SET DEFAULT 'maia_checkr';
UPDATE public.associations SET screening_provider = 'maia_checkr' WHERE screening_provider = 'tenant_evaluation';

NOTIFY pgrst, 'reload schema';
