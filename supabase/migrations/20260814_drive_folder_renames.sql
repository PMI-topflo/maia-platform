-- =====================================================================
-- 20260814_drive_folder_renames.sql
--
-- One row per per-unit Drive folder MAIA renames to the ACCOUNT_ADDRESS
-- convention. Keeps the previous name so a bad run can be walked back —
-- renaming 60 folders in an association's real Drive is not something to do
-- without a record of what they were called before.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.drive_folder_renames (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code  text NOT NULL,
  file_id           text NOT NULL,
  previous_name     text NOT NULL,
  new_name          text NOT NULL,
  reverted_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drive_folder_renames_assoc_idx
  ON public.drive_folder_renames (association_code, created_at DESC);

-- Data-API exposure (REQUIRED — Supabase drops auto-grants 2026-10-30)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_folder_renames
  TO anon, authenticated, service_role;

ALTER TABLE public.drive_folder_renames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_drive_folder_renames" ON public.drive_folder_renames;
CREATE POLICY "service_role_all_drive_folder_renames"
  ON public.drive_folder_renames FOR ALL TO service_role USING (true);
