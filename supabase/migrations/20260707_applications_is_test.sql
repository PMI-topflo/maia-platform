-- Flags applications created via the admin "Test Environment" tab so
-- staff can exercise the real Checkr sandbox end-to-end without a real
-- applicant. See lib/migration-status.ts for the full rationale.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
