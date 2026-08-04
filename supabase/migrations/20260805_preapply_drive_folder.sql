-- =====================================================================
-- 20260805_preapply_drive_folder.sql
--
-- Remember the Google Drive subfolder MAIA creates for each Pre-Application
-- intake under "Unit Docs - On Going Applications". Set when the applicant
-- submits and their documents are mirrored into Drive. ADD COLUMN IF NOT
-- EXISTS is instant + idempotent.
-- =====================================================================

ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS drive_folder_id  text;
ALTER TABLE public.listing_applications ADD COLUMN IF NOT EXISTS drive_folder_url text;

NOTIFY pgrst, 'reload schema';
