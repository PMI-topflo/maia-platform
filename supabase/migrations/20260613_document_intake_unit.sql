-- Compliance Hub Phase 2: unit/owner-scope document intake. MAIA can now
-- classify a document as unit-level and match it to an owner; these columns
-- carry the suggested + applied unit scope through the review→file flow.
-- (compliance_records already supports scope='unit' + unit_ref.) Idempotent.
ALTER TABLE public.document_intake
  ADD COLUMN IF NOT EXISTS suggested_scope      text,
  ADD COLUMN IF NOT EXISTS suggested_unit_ref   text,
  ADD COLUMN IF NOT EXISTS suggested_unit_label text,
  ADD COLUMN IF NOT EXISTS applied_scope        text,
  ADD COLUMN IF NOT EXISTS applied_unit_ref     text,
  -- Multi-policy packet splitting: the original packet + this row's page range
  -- within it, so an over-eager split can be merged back into the previous row.
  ADD COLUMN IF NOT EXISTS source_storage_path  text,
  ADD COLUMN IF NOT EXISTS page_start           int,
  ADD COLUMN IF NOT EXISTS page_end             int;

NOTIFY pgrst, 'reload schema';
