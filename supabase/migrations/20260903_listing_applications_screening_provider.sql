-- =====================================================================
-- 20260903_listing_applications_screening_provider.sql
--
-- User direction, 2026-09-03: flipping an association's screening_provider
-- to maia_checkr (Checkr) must only apply to NEW applications going
-- forward -- applicants already in flight on the current system (Tenant
-- Evaluation) must not be silently re-routed to Checkr partway through,
-- since staff may already be working with them there.
--
-- associations.screening_provider was the only source of truth
-- (application-handoff.ts and the admin pre-apply page both read it LIVE),
-- so flipping it retroactively changed behavior for every application on
-- that association, including ones already submitted/under review. This
-- column snapshots the provider onto the application ITSELF at creation
-- time (lib/preapply.ts's createIntake) -- an application always keeps
-- whatever provider was in effect when it started, regardless of what the
-- association is set to later. NULL means "created before this column
-- existed" -- every real MAIA application before today ran on
-- tenant_evaluation (Checkr was never live before now), so the app-layer
-- fallback for NULL is the literal 'tenant_evaluation', never a live
-- association lookup -- see lib/preapply.ts's resolveScreeningProvider().
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.listing_applications
  ADD COLUMN IF NOT EXISTS screening_provider text;

NOTIFY pgrst, 'reload schema';
