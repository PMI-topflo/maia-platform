-- =====================================================================
-- 20260820_application_reminder_approvals.sql
--
-- The 3-day collective "what's still missing" reminder to every stakeholder
-- on an application (applicant + owner + any agent on file) — gated behind
-- a ONE-TIME approval from PMI + Jonathan. User direction, 2026-08-20:
-- "Send an email with the draft to me and Jonathan with a link to approve
-- by email to be sent to all stakeholders" / "Approve once, then auto-send."
--
-- One row per actual reminder cycle (an audit trail of what was sent when,
-- to whom, and who approved the first one) — not one row per application.
-- The cron (app/api/cron/missing-docs-reminders) reads the newest row for
-- an application to decide what to do next: no row yet → draft and wait;
-- newest is 'approved' → every later cycle auto-sends without asking again;
-- newest is 'pending' → already waiting on the office, don't ask twice;
-- newest is 'declined' → try again after another 3 days.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.application_reminder_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES public.listing_applications(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  missing_summary  jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipients       jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_to          jsonb,
  decided_by       text,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_reminder_approvals_app_idx
  ON public.application_reminder_approvals (application_id, created_at DESC);

-- ── Data-API exposure (Supabase auto-grants stop 2026-10-30) ──────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_reminder_approvals
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
-- service-role only: written by the cron + the token-gated approve page's
-- backend route, both via supabaseAdmin — same pattern as document_requests
-- and addon_draft_views.
ALTER TABLE public.application_reminder_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_application_reminder_approvals" ON public.application_reminder_approvals;
CREATE POLICY "service_role_all_application_reminder_approvals"
  ON public.application_reminder_approvals FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
