-- =====================================================================
-- 20260805_preapply_stakeholder_collab.sql
--
-- Multi-collaboration for the Pre-Application Compliance intake: the person
-- who opens the link self-identifies their role (tenant/owner/listing agent/
-- tenant agent), then adds everyone else involved, and MAIA emails each of
-- them their own link to fill their part in parallel. Only APPLICANTS and
-- OWNERS sign the rules acknowledgment — agents upload but do not sign.
--
-- These are per-stakeholder columns on the existing application_stakeholders
-- table (from 20260628) so verification + signature are tracked per person,
-- not once for the whole application. ADD COLUMN IF NOT EXISTS is idempotent.
-- =====================================================================

ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS signed_at         timestamptz;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS signature_image   text;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS rules_ack_name    text;
ALTER TABLE public.application_stakeholders ADD COLUMN IF NOT EXISTS rules_ack_ip      text;

-- The audit view links every uploaded document to the stakeholder who
-- provided it (already a column since 20260628; index it for the per-person
-- rollup on the audit page).
CREATE INDEX IF NOT EXISTS app_documents_stakeholder_idx
  ON public.application_documents (stakeholder_id);

NOTIFY pgrst, 'reload schema';
