-- =====================================================================
-- MAIA — apply the 4 pending migrations (idempotent; safe to re-run).
-- Paste this whole file into Supabase → SQL Editor → Run.
--   1) Staff Setup profile fields (pmi_staff)
--   2) staff_tasks
--   3) compliance_records
--   4) document_intake (+ compliance_records.source_path)
-- =====================================================================

-- 1) Staff Setup profile fields ---------------------------------------
ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS alias          text,
  ADD COLUMN IF NOT EXISTS personal_phone text,
  ADD COLUMN IF NOT EXISTS working_hours  jsonb;

-- 2) staff_tasks ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_email  text        NOT NULL,
  title           text        NOT NULL,
  source          text        NOT NULL DEFAULT 'manual',
  recurrence      text        NOT NULL DEFAULT 'once',
  next_due        date,
  expiry_date     date,
  notes           text,
  source_ref      text,
  active          boolean     NOT NULL DEFAULT true,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_staff_task_source CHECK (source     IN ('manual','maia')),
  CONSTRAINT chk_staff_task_recur  CHECK (recurrence IN ('once','daily','weekly','monthly','yearly','on_expiry'))
);
CREATE INDEX IF NOT EXISTS staff_tasks_assignee_idx ON public.staff_tasks (assignee_email) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS staff_tasks_source_ref_uniq ON public.staff_tasks (source_ref) WHERE source_ref IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_tasks TO anon, authenticated, service_role;
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_staff_tasks" ON public.staff_tasks;
CREATE POLICY "service_role_all_staff_tasks" ON public.staff_tasks FOR ALL TO service_role USING (true);

-- 3) compliance_records -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            text        NOT NULL DEFAULT 'association',
  association_code text        NOT NULL,
  unit_ref         text        NOT NULL DEFAULT '',
  item_key         text        NOT NULL,
  applicable       boolean     NOT NULL DEFAULT true,
  status           text        NOT NULL DEFAULT 'missing',
  expiry_date      date,
  notes            text,
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_compliance_scope  CHECK (scope  IN ('association','unit')),
  CONSTRAINT chk_compliance_status CHECK (status IN ('current','expiring','pending','missing','non_compliant','na'))
);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_records_uniq ON public.compliance_records (scope, association_code, unit_ref, item_key);
CREATE INDEX IF NOT EXISTS compliance_records_assoc_idx ON public.compliance_records (association_code, scope);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_records TO anon, authenticated, service_role;
ALTER TABLE public.compliance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_compliance_records" ON public.compliance_records;
CREATE POLICY "service_role_all_compliance_records" ON public.compliance_records FOR ALL TO service_role USING (true);

-- 4) document_intake (+ compliance_records.source_path) ---------------
CREATE TABLE IF NOT EXISTS public.document_intake (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path              text        NOT NULL,
  filename                  text,
  mime_type                 text,
  status                    text        NOT NULL DEFAULT 'review',
  suggested_association_code text,
  suggested_category        text,
  suggested_item_key        text,
  doc_type                  text,
  effective_date            date,
  expiration_date           date,
  confidence                numeric,
  summary                   text,
  model                     text,
  applied_association_code  text,
  applied_item_key          text,
  applied_at                timestamptz,
  applied_by                text,
  uploaded_by               text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_doc_intake_status CHECK (status IN ('reading','review','applied','dismissed','error'))
);
CREATE INDEX IF NOT EXISTS document_intake_status_idx ON public.document_intake (status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_intake TO anon, authenticated, service_role;
ALTER TABLE public.document_intake ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_document_intake" ON public.document_intake;
CREATE POLICY "service_role_all_document_intake" ON public.document_intake FOR ALL TO service_role USING (true);
ALTER TABLE public.compliance_records ADD COLUMN IF NOT EXISTS source_path text;

NOTIFY pgrst, 'reload schema';
