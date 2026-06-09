-- =====================================================================
-- 20260608_document_intake.sql
--
-- MAIA Document Inbox — Jonathan bulk-uploads any association document;
-- MAIA reads each, suggests where it files (association + compliance
-- item + dates), and he reviews/applies. One row per uploaded file.
--
-- Also adds compliance_records.source_path so an applied document links
-- back to the file that satisfied it. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.document_intake (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path              text        NOT NULL,
  filename                  text,
  mime_type                 text,
  status                    text        NOT NULL DEFAULT 'review',
  -- MAIA suggestions
  suggested_association_code text,
  suggested_category        text,
  suggested_item_key        text,
  doc_type                  text,
  effective_date            date,
  expiration_date           date,
  confidence                numeric,
  summary                   text,
  model                     text,
  -- applied result
  applied_association_code  text,
  applied_item_key          text,
  applied_at                timestamptz,
  applied_by                text,
  uploaded_by               text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_doc_intake_status CHECK (status IN ('reading','review','applied','dismissed','error'))
);
CREATE INDEX IF NOT EXISTS document_intake_status_idx ON public.document_intake (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_intake
  TO anon, authenticated, service_role;
ALTER TABLE public.document_intake ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_document_intake" ON public.document_intake;
CREATE POLICY "service_role_all_document_intake"
  ON public.document_intake FOR ALL TO service_role USING (true);

-- link an applied compliance item back to its source file
ALTER TABLE public.compliance_records
  ADD COLUMN IF NOT EXISTS source_path text;

NOTIFY pgrst, 'reload schema';
