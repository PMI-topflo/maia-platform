-- =====================================================================
-- 20260831_screening_report_data.sql
--
-- MAIA's Checkr integration has only ever stored the report PDF
-- (screening_subjects.report_url) -- there was no code path that read the
-- structured report body at all (GET /reports/{id}). The 2026-08-30
-- "credit_report / eviction_history come back null" finding (see
-- docs/ROADMAP.md's Checkr entry) was a manual one-off API probe, never
-- persisted anywhere.
--
-- Real root cause, per Checkr support (Victor, 2026-08-31 email) and the
-- Testing guide's "Canned Provider Scenarios" section
-- (checkr-tenant-api-docs.redocly.app/testing#canned-provider-scenarios):
-- a test-mode order only returns populated canned data when first_name,
-- last_name, dob AND ssn all exactly match one of Checkr's documented
-- tuples. A PARTIAL match (e.g. the right ssn, wrong name/dob) is treated
-- as a miss and silently falls through to "the clean scenario for every
-- product" -- which is exactly what
-- app/api/admin/applications/create-test/route.ts's default 'auto'
-- scenario was doing (SSN 333-33-3333, the real Norma Davies tuple's SSN,
-- paired with a generic "Test ApplicantN" name and the wrong DOB). Fixed
-- in the same change that adds this column.
--
-- report_data holds the raw structured GET /reports/{id} response
-- verbatim (jsonb passthrough, not a parsed/typed shape) -- the exact
-- field names for credit/eviction results haven't been confirmed against
-- a real live response from this environment, so this deliberately stores
-- the raw body rather than guessing a schema, per this project's own
-- "confirmed live" discipline (see lib/screening/checkr.ts's file header).
-- =====================================================================

ALTER TABLE public.screening_subjects ADD COLUMN IF NOT EXISTS report_data jsonb;

NOTIFY pgrst, 'reload schema';
