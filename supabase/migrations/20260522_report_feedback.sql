-- =====================================================================
-- 20260522_report_feedback.sql
--
-- One row per (monthly report, recipient) for the report-feedback loop.
-- Created when staff emails the report to an audience; the recipient
-- opens a tokenized /report-feedback/<token> link and submits a 1–5
-- rating + free-text feedback. submitted_at NULL = sent but not yet
-- rated. Idempotent re-sends just bump sent_at.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.report_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         uuid        NOT NULL REFERENCES public.monthly_reports(id) ON DELETE CASCADE,
  recipient_type    text        NOT NULL CHECK (recipient_type IN ('board', 'owner')),
  recipient_email   text        NOT NULL,
  recipient_name    text,
  recipient_label   text,                  -- 'President', 'Unit 305', etc.
  feedback_token    text        NOT NULL UNIQUE,
  rating            int         CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  feedback          text,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  UNIQUE (report_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS report_feedback_report_idx
  ON public.report_feedback (report_id, recipient_type);
CREATE INDEX IF NOT EXISTS report_feedback_token_idx
  ON public.report_feedback (feedback_token);

ALTER TABLE public.report_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_report_feedback" ON public.report_feedback;
CREATE POLICY "service_role_all_report_feedback"
  ON public.report_feedback FOR ALL TO service_role USING (true);
