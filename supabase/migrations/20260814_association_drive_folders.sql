-- =====================================================================
-- 20260814_association_drive_folders.sql
--
-- Per-association Drive folders. The application pipeline used ONE global
-- triple of Manors XI folder ids (lib/drive-organize-folders.ts DRIVE_FOLDERS),
-- so any other association's application would have mirrored its documents
-- into Manors XI's Drive tree — silently, and wrongly.
--
-- Backfilled with the existing MANXI ids so nothing changes for Manors XI.
-- Every other association must set its own before documents can be filed;
-- resolveAssocDriveFolders() returns nulls and callers refuse rather than
-- falling back to somebody else's folders.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS official_folder_id text;
ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS archive_folder_id  text;
ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS ongoing_folder_id  text;

UPDATE public.associations SET
  official_folder_id = COALESCE(official_folder_id, '1kRDm6ajZr8lXuXGcAXTnA3vigzhLCZpz'),
  archive_folder_id  = COALESCE(archive_folder_id,  '11mMQghXeQfPuXEO4YnWgecqaTKuLKhs8'),
  ongoing_folder_id  = COALESCE(ongoing_folder_id,  '1rX11uKdi5y0rAfaLPvRRlJ_aCactViuZ')
WHERE association_code = 'MANXI';
