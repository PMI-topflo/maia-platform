-- Document classification redesign: MAIA no longer splits a bundled
-- document (e.g. an ACORD insurance packet) into physical per-coverage
-- files. Instead one uploaded file gets one document_intake row, tagged
-- with EVERY compliance item it satisfies via this new jsonb column;
-- staff multi-select from it (or add more) and file once per tag, all
-- against the same undivided document. Idempotent.

ALTER TABLE public.document_intake ADD COLUMN IF NOT EXISTS suggested_items jsonb;
ALTER TABLE public.document_intake ADD COLUMN IF NOT EXISTS applied_items jsonb;

NOTIFY pgrst, 'reload schema';
