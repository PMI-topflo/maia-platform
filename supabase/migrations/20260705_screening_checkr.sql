-- Replace the dead ApplyCheck integration (no public API) with Checkr.
-- Renames the old applycheck_* columns to provider-neutral screening_* names
-- (idempotent — guarded so re-running after the rename already happened is a
-- no-op) and adds a dedicated screening_subjects table: one application can
-- have several screening subjects (each applicant, or each commercial
-- principal), each with its own Checkr candidate/report and consent state.
-- applications.screening_* stays as the aggregate rollup the board/review
-- page already reads.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='applications' AND column_name='applycheck_status') THEN
    ALTER TABLE public.applications RENAME COLUMN applycheck_status TO screening_status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='applications' AND column_name='applycheck_report_url') THEN
    ALTER TABLE public.applications RENAME COLUMN applycheck_report_url TO screening_report_url;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='applications' AND column_name='applycheck_result') THEN
    ALTER TABLE public.applications RENAME COLUMN applycheck_result TO screening_result;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='applications' AND column_name='applycheck_completed_at') THEN
    ALTER TABLE public.applications RENAME COLUMN applycheck_completed_at TO screening_completed_at;
  END IF;
END $$;

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS screening_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS screening_report_url text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS screening_result jsonb;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS screening_completed_at timestamptz;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS screening_provider text NOT NULL DEFAULT 'checkr';

CREATE TABLE IF NOT EXISTS public.screening_subjects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     uuid NOT NULL REFERENCES public.applications(id),
  subject_index      int  NOT NULL,
  name               text,
  email              text,
  is_commercial      boolean NOT NULL DEFAULT false,
  checkr_candidate_id text,
  checkr_report_id    text,
  consented          boolean NOT NULL DEFAULT false,
  consented_at       timestamptz,
  status             text NOT NULL DEFAULT 'pending',   -- pending | awaiting_consent | invited | complete | error
  report_url         text,
  result             jsonb,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screening_subjects_uniq UNIQUE (application_id, subject_index)
);
CREATE INDEX IF NOT EXISTS screening_subjects_candidate_idx ON public.screening_subjects (checkr_candidate_id);
CREATE INDEX IF NOT EXISTS screening_subjects_report_idx ON public.screening_subjects (checkr_report_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.screening_subjects TO anon, authenticated, service_role;
ALTER TABLE public.screening_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_screening_subjects" ON public.screening_subjects;
CREATE POLICY "service_role_all_screening_subjects" ON public.screening_subjects FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
