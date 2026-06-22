-- =====================================================================
-- 20260622_maia_knowledge.sql
--
-- "Teach MAIA" knowledge studio. Each row is one taught fact or document
-- that PMI staff have given MAIA to learn. Scoped three ways:
--   • association_code  — NULL = applies to ALL associations
--   • persona           — NULL = applies to ALL personas; else one of
--                         homeowner | tenant | board | vendor | buyer | agent
--   • account_number    — NULL = applies to ALL units in the association;
--                         else a specific owner account (owners.account_number).
--                         unit_number is stored alongside for display only.
--
-- Lifecycle (status):
--   needs_review → MAIA has read the source and proposed what she
--                  understood; a human must confirm.
--   approved     → staff approved; ONLY these rows are injected into
--                  MAIA's prompts (widget / email / voice).
--   rejected     → discarded, kept for audit.
--
-- raw_extract        = the text MAIA pulled from the upload (PDF text,
--                      image transcription, or pasted text).
-- understood_summary = MAIA's plain-language "here's what I understood"
--                      (shown to staff for approve / correct).
-- approved_body      = the clean, canonical knowledge that gets injected.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maia_knowledge (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text,
  persona            text,
  account_number     text,
  unit_number        text,
  title              text NOT NULL,
  source_kind        text NOT NULL DEFAULT 'text',   -- text | pdf | image | chat
  source_filename    text,
  source_path        text,                           -- storage path (best-effort)
  raw_extract        text,
  understood_summary text,
  approved_body      text,
  status             text NOT NULL DEFAULT 'needs_review',
  created_by         text,
  reviewed_by        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Injection access path: filter by scope + status on every MAIA answer.
CREATE INDEX IF NOT EXISTS maia_knowledge_inject_idx
  ON public.maia_knowledge (association_code, persona, status);

-- ── Data-API exposure (REQUIRED for tables created on/after 2026-10-30) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maia_knowledge
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.maia_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_maia_knowledge" ON public.maia_knowledge;
CREATE POLICY "service_role_all_maia_knowledge"
  ON public.maia_knowledge FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
