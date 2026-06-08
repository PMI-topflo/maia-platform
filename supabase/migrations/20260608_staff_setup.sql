-- =====================================================================
-- 20260608_staff_setup.sql
--
-- Backs the Staff Setup page:
--   pmi_staff  — add alias, personal_phone, working_hours (per-weekday
--                check-in/out + flexible lunch minutes, stored as JSON).
--                (personal_email already exists; `phone` = company phone.)
--   staff_tasks — recurring tasks/reminders per staffer (MAIA-created +
--                manual), which feed MAIA's Daily News journal.
--
-- Idempotent.
-- =====================================================================

-- ── pmi_staff columns (existing table → no GRANTs needed) ────────────
ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS alias          text,
  ADD COLUMN IF NOT EXISTS personal_phone text,
  ADD COLUMN IF NOT EXISTS working_hours  jsonb;

-- ── staff_tasks (new table) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_email  text        NOT NULL,
  title           text        NOT NULL,
  source          text        NOT NULL DEFAULT 'manual',
  recurrence      text        NOT NULL DEFAULT 'once',
  next_due        date,
  expiry_date     date,
  notes           text,
  source_ref      text,                     -- dedup key for auto-created tasks (e.g. 'inspection:<id>')
  active          boolean     NOT NULL DEFAULT true,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_staff_task_source CHECK (source     IN ('manual','maia')),
  CONSTRAINT chk_staff_task_recur  CHECK (recurrence IN ('once','daily','weekly','monthly','yearly','on_expiry'))
);
CREATE INDEX IF NOT EXISTS staff_tasks_assignee_idx
  ON public.staff_tasks (assignee_email) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS staff_tasks_source_ref_uniq
  ON public.staff_tasks (source_ref) WHERE source_ref IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_tasks
  TO anon, authenticated, service_role;
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_staff_tasks" ON public.staff_tasks;
CREATE POLICY "service_role_all_staff_tasks"
  ON public.staff_tasks FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
