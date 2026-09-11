-- =====================================================================
-- 20260911_association_onboarding_proposals.sql
--
-- "What they have today" — MAIA reads an association's filed documents
-- (application package, Rules & Regulations, Declaration / By-Laws) and
-- PROPOSES the onboarding questionnaire's answers, each with the quoted
-- passage. Staff accept or reject; an accepted proposal becomes an
-- `existing_config` decision (association_onboarding_decisions) and is
-- applied at once, so an association goes live with its current
-- requirements without a board meeting. User direction, 2026-09-11.
--
--   association_onboarding_extractions — one row per run: model, the
--     plain-English "how they handle applications today" summary, the
--     documents read.
--   association_onboarding_proposals   — one row per proposed item (or
--     "extra" finding with no catalog slot yet) with status pending →
--     accepted | rejected | superseded (a newer run replaces pending rows).
--
-- Idempotent. Registered in lib/migration-status.ts.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.association_onboarding_extractions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code  text NOT NULL,
  model             text NOT NULL,
  today_summary     text,
  documents         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS association_onboarding_extractions_code_idx
  ON public.association_onboarding_extractions (association_code, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_onboarding_extractions
  TO anon, authenticated, service_role;
ALTER TABLE public.association_onboarding_extractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_onboarding_extractions" ON public.association_onboarding_extractions;
CREATE POLICY "service_role_all_association_onboarding_extractions"
  ON public.association_onboarding_extractions FOR ALL TO service_role USING (true);

CREATE TABLE IF NOT EXISTS public.association_onboarding_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code  text NOT NULL,
  extraction_id     uuid NOT NULL REFERENCES public.association_onboarding_extractions(id) ON DELETE CASCADE,
  kind              text NOT NULL DEFAULT 'proposal' CHECK (kind IN ('proposal', 'extra')),
  item_key          text,                 -- catalog / checklist key (proposal) or null (extra)
  proposed_value    jsonb,
  invalid_reason    text,                 -- set when the model's value failed validation
  topic             text,                 -- extras
  finding           text,                 -- extras
  quote             text,
  source            text,                 -- filename the quote came from
  confidence        text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  rationale         text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  decision_id       uuid REFERENCES public.association_onboarding_decisions(id) ON DELETE SET NULL,
  reviewed_by       text,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS association_onboarding_proposals_code_idx
  ON public.association_onboarding_proposals (association_code, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_onboarding_proposals
  TO anon, authenticated, service_role;
ALTER TABLE public.association_onboarding_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_onboarding_proposals" ON public.association_onboarding_proposals;
CREATE POLICY "service_role_all_association_onboarding_proposals"
  ON public.association_onboarding_proposals FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
