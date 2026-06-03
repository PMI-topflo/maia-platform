-- =====================================================================
-- 20260603_maia_improvement_ideas.sql
--
-- Backlog of "make MAIA better" ideas submitted by staff, primarily via
-- the per-person link in the daily "PMI Top Florida Daily News" email.
-- Fabio triages them on /admin/ideas: new → accepted → done, or deleted.
--
-- `status` lifecycle: 'new' (just submitted) → 'accepted' (greenlit for
-- dev) → 'done' (shipped). 'deleted' is a soft-delete so nothing is lost.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maia_improvement_ideas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea               text        NOT NULL,
  submitted_by_name  text,
  submitted_by_email text,
  source             text        NOT NULL DEFAULT 'daily_news',
  status             text        NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','accepted','done','deleted')),
  triaged_by         text,
  triaged_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────
-- The admin board lists by status, newest first.
CREATE INDEX IF NOT EXISTS maia_improvement_ideas_status_created_idx
  ON public.maia_improvement_ideas (status, created_at DESC);

-- ── Data-API exposure (REQUIRED — see _TEMPLATE_new_table.sql) ───────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maia_improvement_ideas
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.maia_improvement_ideas ENABLE ROW LEVEL SECURITY;

-- All reads/writes go through the service-role admin client (cron insert,
-- public submit endpoint, and the staff-only /admin/ideas board), so an
-- explicit service_role FOR ALL policy is the only one needed.
DROP POLICY IF EXISTS "service_role_all_maia_improvement_ideas" ON public.maia_improvement_ideas;
CREATE POLICY "service_role_all_maia_improvement_ideas"
  ON public.maia_improvement_ideas FOR ALL TO service_role USING (true);
