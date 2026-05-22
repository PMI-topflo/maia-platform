-- =====================================================================
-- 20260522_report_financials.sql
--
-- Stores the financial statement (CINC PDF) uploaded for a monthly
-- management report, plus the headline figures MAIA auto-extracts from
-- it. One row per (association, month) — re-uploading upserts on that
-- pair. The PDF itself lives in the private `report-financials` storage
-- bucket; `storage_path` points at it.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.report_financials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text        NOT NULL DEFAULT 'ALL',
  month              text        NOT NULL,            -- 'YYYY-MM'
  storage_path       text        NOT NULL,            -- PDF in report-financials bucket
  pdf_filename       text        NOT NULL,
  pdf_size_bytes     bigint      NOT NULL,
  figures            jsonb,                           -- extracted headline figures
  extract_status     text        NOT NULL DEFAULT 'pending'
                       CHECK (extract_status IN ('pending', 'extracted', 'failed')),
  extract_error      text,
  uploaded_by_email  text,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  extracted_at       timestamptz,
  UNIQUE (association_code, month)
);

CREATE INDEX IF NOT EXISTS report_financials_assoc_idx
  ON public.report_financials (association_code, month DESC);

ALTER TABLE public.report_financials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_report_financials" ON public.report_financials;
CREATE POLICY "service_role_all_report_financials"
  ON public.report_financials FOR ALL TO service_role USING (true);
