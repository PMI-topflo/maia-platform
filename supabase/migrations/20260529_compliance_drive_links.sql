-- =====================================================================
-- 20260529_compliance_drive_links.sql
--
-- Lets the association-level compliance trackers point at a Google Drive
-- file INSTEAD OF (or in addition to) an uploaded file. Per the storage
-- policy in COMPLIANCE_TRACKING.md, not every file needs to live in the
-- system — staff (Isabela) can paste/update a Drive link from the screen
-- when a new file is placed in Drive.
--
-- Both columns are nullable, additive, idempotent.
-- =====================================================================

alter table public.association_insurance_policies
  add column if not exists drive_url text;

alter table public.association_safety_inspections
  add column if not exists drive_url text;

NOTIFY pgrst, 'reload schema';
