-- =====================================================================
-- 20260628_association_documents_is_public.sql
--
-- Per-document PUBLIC flag. When a staff member marks a document public, it
-- shows on the association's main page to the GENERAL PUBLIC (no login). Board
-- request: give the public access to public documents without identifying.
-- Defaults FALSE — nothing is public until a staff member opts it in. Idempotent.
-- =====================================================================

ALTER TABLE public.association_documents
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- Fast lookup of an association's public, current documents.
CREATE INDEX IF NOT EXISTS adocs_public_idx
  ON public.association_documents (association_code, category)
  WHERE is_public AND archived_at IS NULL;

NOTIFY pgrst, 'reload schema';
