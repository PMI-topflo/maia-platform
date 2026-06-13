-- Phase C PR2: record the outcome of each estimate-request vendor once the
-- board awards a winner, so the award/loser notices fire exactly once and the
-- winner's missing-compliance request is tracked.
--   outcome            'won' | 'lost' (null = not yet decided)
--   outcome_notified_at when we emailed the award / not-selected notice
-- Idempotent.
ALTER TABLE public.estimate_request_vendors
  ADD COLUMN IF NOT EXISTS outcome             text,
  ADD COLUMN IF NOT EXISTS outcome_notified_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_estreqv_outcome') THEN
    ALTER TABLE public.estimate_request_vendors
      ADD CONSTRAINT chk_estreqv_outcome CHECK (outcome IS NULL OR outcome IN ('won','lost'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
