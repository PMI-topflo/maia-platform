-- =====================================================================
-- 20260913_owners_cinc_homeowner_status.sql
--
-- Cache CINC's record-level homeowner status (e.g. "Developer -
-- NonBillable") on the MAIA owner row. The CINC sync preview used to look
-- it up only for rows about to be inserted/updated, so an existing row
-- that had nothing to change (LCLUB "LVUnits", 2026-09-13) silently lost
-- its Non-billable badge and showed as SYNCED. Existing table: no GRANT
-- block needed. Idempotent; registered in lib/migration-status.ts.
-- =====================================================================
ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS cinc_homeowner_status text;
ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS cinc_status_checked_at timestamptz;
NOTIFY pgrst, 'reload schema';
