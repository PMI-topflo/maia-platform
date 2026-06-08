-- =====================================================================
-- 20260608_projects_inspections.sql
--
-- Two per-association tables behind the Association Hub's last net-new
-- tabs:
--   association_projects     — capital / large projects (roof replacement,
--                              40-yr recert, repaint) with budget + progress.
--   association_inspections  — compliance certifications (SB-4D milestone,
--                              reserve study, fire, elevator) with next-due
--                              dates; status is derived from next_due.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

-- ── Projects ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.association_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  name             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'planning',
  vendor_name      text,
  budget           numeric,
  spent            numeric,
  target_date      date,
  pct_complete     integer     NOT NULL DEFAULT 0,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_proj_status CHECK (status IN ('planning','bidding','in_progress','on_hold','complete')),
  CONSTRAINT chk_proj_pct    CHECK (pct_complete BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS association_projects_assoc_idx
  ON public.association_projects (association_code) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_projects
  TO anon, authenticated, service_role;
ALTER TABLE public.association_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_projects" ON public.association_projects;
CREATE POLICY "service_role_all_association_projects"
  ON public.association_projects FOR ALL TO service_role USING (true);

-- ── Inspections ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.association_inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  inspection_type  text        NOT NULL,
  last_done        date,
  next_due         date,
  inspector        text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS association_inspections_assoc_idx
  ON public.association_inspections (association_code) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_inspections
  TO anon, authenticated, service_role;
ALTER TABLE public.association_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_inspections" ON public.association_inspections;
CREATE POLICY "service_role_all_association_inspections"
  ON public.association_inspections FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
