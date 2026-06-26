-- =====================================================================
-- 20260625_applycheck_results.sql
--
-- Columns to capture inbound Applycheck background-check results.
--
-- trigger-applycheck opens one screening per subject, each carrying
-- reference = applications.id and webhook_url = /api/applycheck-webhook.
-- Applycheck then calls that webhook (one call per subject) as results come
-- in. The receiver records the report link + status and ARCHIVES the raw
-- payloads so the future board-package step has the full detail.
--
-- applications is an existing table — legacy grants apply, no GRANT block
-- needed. Idempotent.
-- =====================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS applycheck_result       jsonb,        -- append-only array of received webhook payloads
  ADD COLUMN IF NOT EXISTS applycheck_completed_at timestamptz;  -- last results callback received

NOTIFY pgrst, 'reload schema';
