-- Corrects the Checkr integration to match the REAL Checkr Tenant Screening
-- API (https://checkr-tenant-api-docs.redocly.app/), confirmed against live
-- docs 2026-07-05 -- the original build (commit 1353567) was written from
-- Checkr's general employment-background-check API conventions (Candidates +
-- Reports, HTTP Basic auth), which turned out to be the WRONG product for
-- PMI's tenant/buyer screening use case. The real Tenant API is a single
-- POST /orders call (Bearer auth), no embeddable consent widget -- Checkr
-- emails the applicant a link to their own hosted page instead.
--
-- Additive only: old checkr_candidate_id/checkr_report_id/consented/
-- consented_at columns are left in place (unused going forward, not
-- destroyed) per this project's migration discipline. New checkr_order_id
-- is what trigger-screening/checkr-webhook actually read/write now.

ALTER TABLE public.screening_subjects ADD COLUMN IF NOT EXISTS checkr_order_id text;
CREATE INDEX IF NOT EXISTS screening_subjects_order_idx ON public.screening_subjects (checkr_order_id);

NOTIFY pgrst, 'reload schema';
