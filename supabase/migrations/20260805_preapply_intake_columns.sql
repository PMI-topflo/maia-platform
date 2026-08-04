-- =====================================================================
-- 20260805_preapply_intake_columns.sql
--
-- Columns for the Pre-Application Compliance intake (B4 slice 2), added to the
-- existing collaborative-leasing foundation (20260628_application_stakeholders)
-- rather than a new table:
--   listing_applications.application_type  — lease | purchase | additional_occupant | lease_renewal
--   listing_applications.applicant_role    — how the applicant self-identified
--   listing_applications.association_code  — denormalized for the audit queue
--   listing_applications.unit_label        — human unit no snapshot
--   listing_applications.rules_ack         — shown-&-signed rules acknowledgment
--                                            { name, signature, ip, at }
--   listing_applications.submitted_at      — when the applicant submitted
--   application_documents.doc_key/doc_label — which intake checklist item an
--                                            upload satisfies (kind stays 'other')
-- ADD COLUMN IF NOT EXISTS is instant + idempotent.
-- =====================================================================

ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS application_type text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS applicant_role   text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS association_code text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS unit_label       text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS rules_ack        jsonb;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS submitted_at     timestamptz;
ALTER TABLE public.application_documents ADD COLUMN IF NOT EXISTS doc_key   text;
ALTER TABLE public.application_documents ADD COLUMN IF NOT EXISTS doc_label text;

NOTIFY pgrst, 'reload schema';
