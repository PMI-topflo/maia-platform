-- =====================================================================
-- 20260611_wo_attachment_phase.sql
-- Tag a work-order photo as a "before" or "after" shot so the work order (and
-- its report) can show the job's progress. NULL = untagged (documents, etc.).
-- Idempotent.
-- =====================================================================
ALTER TABLE public.work_order_attachments
  ADD COLUMN IF NOT EXISTS phase text CHECK (phase IS NULL OR phase IN ('before', 'after'));
NOTIFY pgrst, 'reload schema';
