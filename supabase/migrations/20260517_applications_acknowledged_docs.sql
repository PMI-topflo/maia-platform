-- =====================================================================
-- applications.acknowledged_document_ids
--
-- Records exactly which association_documents row(s) an applicant
-- acknowledged when they signed the rules step. Matters for audit:
-- when staff replaces the Rules PDF in 2027, anyone disputing "I
-- never saw that rule" can be checked against the specific document
-- version that was current when they signed.
--
-- Nullable / empty array is fine — pre-existing applications won't
-- have this set, and applications submitted for associations with no
-- uploaded docs will have an empty array (signature still valid, just
-- no doc was on file at the time).
-- =====================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS acknowledged_document_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

COMMENT ON COLUMN public.applications.acknowledged_document_ids IS
  'IDs from association_documents the applicant read + acknowledged at signature time. Empty array means no docs were on file when they signed.';
