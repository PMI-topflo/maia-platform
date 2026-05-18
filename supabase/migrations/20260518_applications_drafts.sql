-- =====================================================================
-- applications — save-and-continue-later support
--
-- Lets an applicant fill out part of the form, leave, and resume from
-- a link emailed to them. The existing per-field columns
-- (applicants jsonb, rules_signature, docs_*_url, etc.) already store
-- the durable data; this migration adds the small bit of intermediate
-- UI state and routing context needed for clean resumption.
--
-- - draft_step           which step (0..N) the applicant was on when
--                        they last saved. Form lands them here on
--                        resume so they don't have to click through.
-- - draft_data           grab-bag of intermediate state the per-field
--                        columns don't cover: lease parse output,
--                        per-category selected language, viewed doc
--                        ids, etc. JSONB so it's flexible without
--                        another migration per field.
-- - resume_email         the email we sent the resume link to. Stored
--                        so the load endpoint can show "we sent your
--                        progress link to X" + so we don't accidentally
--                        re-send the link if they refresh.
-- - resume_link_sent_at  timestamp of last resume-link email so we can
--                        rate-limit resends.
-- =====================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS draft_step          int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draft_data          jsonb,
  ADD COLUMN IF NOT EXISTS resume_email        text,
  ADD COLUMN IF NOT EXISTS resume_link_sent_at timestamptz;

COMMENT ON COLUMN public.applications.draft_step IS
  'UI step the applicant was on when they last saved progress. 0 = start.';
COMMENT ON COLUMN public.applications.draft_data IS
  'Intermediate UI state for resume: { selectedDocPerCategory, docsViewed, leaseData, ... }';
COMMENT ON COLUMN public.applications.resume_email IS
  'Email address the resume link was sent to. Used to suppress re-sending and to display "we sent your progress to X".';
