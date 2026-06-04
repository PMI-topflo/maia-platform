-- =====================================================================
-- 20260605_vendor_doc_extraction.sql
--
-- Store what Claude reads off a vendor-uploaded document (W-9 / COI / ACH
-- / license / estimate ...) BEFORE the file is compressed for storage. The
-- extractor classifies the doc and pulls a few key fields (sensitive values
-- masked to last-4 in the extractor, never stored in full).
--
-- Idempotent: adds nullable columns to work_order_attachments.
-- =====================================================================

ALTER TABLE public.work_order_attachments
  ADD COLUMN IF NOT EXISTS extracted_doc_type text,          -- 'w9' | 'coi' | 'ach' | 'license' | 'insurance' | 'estimate' | 'invoice' | 'other'
  ADD COLUMN IF NOT EXISTS extracted_data     jsonb,         -- { confidence, summary, fields:{...masked} }
  ADD COLUMN IF NOT EXISTS extracted_at       timestamptz;

NOTIFY pgrst, 'reload schema';
