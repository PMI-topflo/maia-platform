-- Compliance Outreach: record when an owner first opens their self-service link
-- (i.e. clicked the email), so staff can see engagement on the outreach page.
-- Idempotent.
ALTER TABLE public.owner_compliance_requests
  ADD COLUMN IF NOT EXISTS opened_at timestamptz;

NOTIFY pgrst, 'reload schema';
