-- =====================================================================
-- association_documents — soft-archive versioning
--
-- When staff uploads a NEW Condo Docs or Rules PDF, the previous active
-- row in that category is "archived" rather than deleted. Archived rows
-- still own their storage object and are still visible in the docs UI
-- under a "Previous versions" expander; staff can restore an archived
-- row to current with one click.
--
-- Why a soft column instead of a separate `association_document_versions`
-- table: each upload is already a fresh row in association_documents
-- with the same association_code + category. We don't need a parallel
-- history table — we just need a flag that says "this row is no longer
-- the current version" so the filter logic in the apply flow and
-- owner/board portals can ignore it. The latest row per category where
-- archived_at IS NULL is the current version.
-- =====================================================================

ALTER TABLE public.association_documents
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_email text;

COMMENT ON COLUMN public.association_documents.archived_at IS
  'Set when staff uploads a newer version of the same association_code + category. NULL = current version.';
COMMENT ON COLUMN public.association_documents.archived_by_email IS
  'Email of the staff member who triggered the archive (either by uploading a replacement or explicit archive action).';

-- Speeds up the per-category lookup the apply flow and portals do:
-- "give me the newest non-archived row for category X". Partial index
-- keeps it small — most rows in steady state are NOT archived.
CREATE INDEX IF NOT EXISTS adocs_active_per_category_idx
  ON public.association_documents (association_code, category, created_at DESC)
  WHERE archived_at IS NULL;
