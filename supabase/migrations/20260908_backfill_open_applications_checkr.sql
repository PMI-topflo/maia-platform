-- =====================================================================
-- 20260908_backfill_open_applications_checkr.sql
--
-- User report, 2026-09-08 (Quentin Jamal Smith & Timothy Dean Walker,
-- MANXI Unit 706): "some open applications still have the Rentvine info
-- and I can't send them to Checkr." listing_applications.screening_provider
-- is a snapshot frozen once, at creation, from the association's LIVE
-- screening_provider at that moment (lib/preapply.ts's createIntake()) --
-- flipping every association's default to maia_checkr (20260906b) only
-- changed what NEW applications snapshot; every application already open
-- from before that flip is stuck reading 'tenant_evaluation' forever,
-- which (since PR #796 retired the manual "Switch this application to
-- Checkr" button) now shows a dead-end informational note with no way to
-- actually trigger Checkr at all.
--
-- CORRECTED 2026-09-08 (same day, after the first version of this
-- migration ran with zero visible effect): resolveScreeningProvider()
-- (lib/preapply.ts) treats a NULL screening_provider exactly like the
-- literal string 'tenant_evaluation' -- its own fallback default when the
-- value isn't recognized. The first version of this migration only
-- matched the literal string, so it silently skipped every application
-- whose screening_provider had never been populated at all (rows from
-- before this column existed, or otherwise never set) -- which, per the
-- user's report, was apparently most or all of the stuck ones.
--
-- One-time backfill: any application still open (not approved, declined,
-- or withdrawn) with screening_provider NULL or 'tenant_evaluation' gets
-- moved onto maia_checkr now. Anything already decided is left untouched
-- -- its screening is done, real work has already happened against
-- whatever provider it used, and there is nothing left for a provider
-- flip to unlock for it.
--
-- Idempotent -- re-running only touches rows that still qualify.
-- =====================================================================

UPDATE public.listing_applications
   SET screening_provider = 'maia_checkr'
 WHERE (screening_provider = 'tenant_evaluation' OR screening_provider IS NULL)
   AND status NOT IN ('approved', 'declined', 'withdrawn');

NOTIFY pgrst, 'reload schema';
