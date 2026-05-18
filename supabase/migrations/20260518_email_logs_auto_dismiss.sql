-- =====================================================================
-- email_logs auto-dismiss: noise senders + internal staff-to-staff
--
-- Investigation showed 92k inbound emails in 10 days, ~46% internal
-- staff-to-staff mail and ~25% automated system notifications. The
-- manual dismiss button can't keep up. This migration:
--
--   1. Adds a `email_noise_senders` denylist (sender or @domain
--      patterns). Future inbound mail matching the list is auto-
--      dismissed by lib/email-logger.ts on insert.
--   2. Adds an `auto_dismiss_reason` column on email_logs so the UI
--      can show why a row was auto-flagged ('noise_sender' /
--      'internal') and distinguish from manual dismissals.
--   3. Seeds the denylist with the top noisy senders identified
--      from production data.
--   4. Backfills existing (last 60 days) email_logs rows that match
--      either rule, so the queue clears immediately after deploy
--      instead of waiting for the next 60 days of incoming mail to
--      cycle through.
--
-- The audit row is preserved either way — dismissal is a UI flag.
-- =====================================================================

-- 1. The denylist table.
CREATE TABLE IF NOT EXISTS public.email_noise_senders (
  id              bigserial   PRIMARY KEY,
  pattern         text        NOT NULL UNIQUE,  -- exact email OR '@domain' prefix
  reason          text,                          -- free-form note ("CINC notifications", etc.)
  added_by_email  text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.email_noise_senders.pattern IS
  'Either a full email address (e.g. "donotreply@cincsystems.net") or a domain pattern starting with @ (e.g. "@enverasystems.com" to match any sender from that domain). Lowercased on lookup.';

ALTER TABLE public.email_noise_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_email_noise_senders"
  ON public.email_noise_senders FOR ALL TO service_role USING (true);

-- 2. The reason column on email_logs.
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS auto_dismiss_reason text
    CHECK (auto_dismiss_reason IS NULL OR auto_dismiss_reason IN ('noise_sender', 'internal'));

COMMENT ON COLUMN public.email_logs.auto_dismiss_reason IS
  'When set, dismissed_at was set by the system (not by staff). noise_sender = matched email_noise_senders. internal = both sender + recipient are PMI staff.';

-- 3. Seed the denylist with the top noisy senders from production.
INSERT INTO public.email_noise_senders (pattern, reason, added_by_email) VALUES
  ('donotreply@cincsystems.net',             'CINC automated notifications',     'system'),
  ('@cincsystems.com',                       'CINC support team auto-notifications', 'system'),
  ('videorequest@enverasystems.com',         'Envera video / access alerts',     'system'),
  ('listingalert@propertyblasthomes.com',    'Real estate listing alerts',       'system'),
  ('reminders@facebookmail.com',             'Facebook notification emails',     'system'),
  ('fpl_email_bill@billing.fpl.com',         'FPL utility bill emails',          'system'),
  ('sales@selectsaunas.com',                 'SelectSaunas marketing',           'system'),
  ('marketing@propertymanagementinc.com',    'PMI corporate marketing',          'system'),
  ('register@miamire.com',                   'Miami real estate registrations',  'system'),
  ('maia@pmitop.com',                        'MAIA auto-reply loop — review',    'system')
ON CONFLICT (pattern) DO NOTHING;

-- 4. Backfill: auto-dismiss matching rows in the last 60 days so the
--    existing queue clears immediately. Older rows are left alone (if
--    staff need to audit them, they're still queryable).

-- 4a. Match noise senders by exact + domain.
WITH patterns AS (
  SELECT pattern, lower(pattern) AS lc FROM public.email_noise_senders
)
UPDATE public.email_logs el
   SET dismissed_at        = COALESCE(el.dismissed_at, NOW()),
       dismissed_by_email  = COALESCE(el.dismissed_by_email, 'system'),
       auto_dismiss_reason = 'noise_sender'
  WHERE el.dismissed_at IS NULL
    AND el.created_at > NOW() - interval '60 days'
    AND el.from_email IS NOT NULL
    AND (
      -- exact email match
      EXISTS (SELECT 1 FROM patterns p WHERE p.lc = lower(el.from_email))
      OR
      -- domain pattern match (pattern like '@domain.com')
      EXISTS (
        SELECT 1 FROM patterns p
         WHERE p.lc LIKE '@%'
           AND lower(el.from_email) LIKE '%' || p.lc
      )
    );

-- 4b. Internal staff-to-staff: from a staff address (any column or
--     alt_emails entry) AND to a connected staff_gmail_accounts inbox.
WITH staff_emails AS (
  SELECT lower(email)          AS e FROM public.pmi_staff WHERE email IS NOT NULL
  UNION
  SELECT lower(personal_email) AS e FROM public.pmi_staff WHERE personal_email IS NOT NULL
  UNION
  SELECT lower(alt)            AS e FROM public.pmi_staff,
         unnest(COALESCE(alt_emails, ARRAY[]::text[])) AS alt
)
UPDATE public.email_logs el
   SET dismissed_at        = COALESCE(el.dismissed_at, NOW()),
       dismissed_by_email  = COALESCE(el.dismissed_by_email, 'system'),
       auto_dismiss_reason = 'internal'
  WHERE el.dismissed_at IS NULL
    AND el.created_at > NOW() - interval '60 days'
    AND el.from_email IS NOT NULL
    AND el.to_email   IS NOT NULL
    AND lower(el.from_email) IN (SELECT e FROM staff_emails)
    AND lower(el.to_email)   IN (
      SELECT lower(gmail_address) FROM public.staff_gmail_accounts
    );
