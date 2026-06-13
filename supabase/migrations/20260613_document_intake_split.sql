-- Compliance Hub: multi-policy packet splitting. When MAIA splits a bundled
-- PDF (e.g. an ACORD packet) into one file per policy, each intake row records
-- the original packet + its page range so an over-eager split can be merged
-- back into the previous row ("Append to previous"). Idempotent.
ALTER TABLE public.document_intake
  ADD COLUMN IF NOT EXISTS source_storage_path text,
  ADD COLUMN IF NOT EXISTS page_start          int,
  ADD COLUMN IF NOT EXISTS page_end            int;

NOTIFY pgrst, 'reload schema';
