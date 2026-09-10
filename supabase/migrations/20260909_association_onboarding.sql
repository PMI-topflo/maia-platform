-- =====================================================================
-- 20260909_association_onboarding.sql
--
-- Association onboarding questionnaire (applications scope first).
--
-- Two tables:
--   association_onboarding_sessions  — one row per association: where the
--     questionnaire stands (draft → adopted), the board meeting that adopted
--     it, and who ran it.
--   association_onboarding_decisions — APPEND-ONLY register. One row per
--     answer, stamped with who decided (a board member by name + role, or
--     staff for identity facts), the source (meeting vote / email consent /
--     staff-confirmed fact / existing configuration), when, and — after
--     adoption — when it was applied to the live setting and any error.
--     The latest row per (association_code, item_key) is the current answer;
--     earlier rows are history and are never updated or deleted.
--
-- Decisions are NOT live settings. On adoption, lib/onboarding.ts applies
-- each unapplied decision to the table that already drives the behaviour
-- (associations, association_config, association_application_rules,
-- association_intake_documents, board_approval_config,
-- board_approval_members). Nothing reads these two tables at runtime.
--
-- Also adds board_approval_config.decision_window_days: the board's own
-- decision window from the questionnaire. lib/board-review.ts's
-- computeBoardWindow consults it after the per-association code override
-- (lib/board-decision-rules.ts) and before the per-application column.
--
-- Idempotent. Registered in lib/migration-status.ts.
-- =====================================================================

-- ── Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.association_onboarding_sessions (
  association_code  text PRIMARY KEY,
  status            text        NOT NULL DEFAULT 'draft',   -- draft | adopted
  current_section   text,
  meeting_date      date,
  motion_by         text,
  vote              text,
  minutes_path      text,
  started_by        text,
  adopted_by        text,
  adopted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_onboarding_session_status CHECK (status IN ('draft','adopted'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_onboarding_sessions
  TO anon, authenticated, service_role;
ALTER TABLE public.association_onboarding_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_onboarding_sessions" ON public.association_onboarding_sessions;
CREATE POLICY "service_role_all_association_onboarding_sessions"
  ON public.association_onboarding_sessions FOR ALL TO service_role USING (true);

-- ── Decisions (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.association_onboarding_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code  text        NOT NULL,
  item_key          text        NOT NULL,   -- lib/onboarding-catalog.ts key, or checklist.<type>.<doc_key>
  value             jsonb       NOT NULL,
  note              text,
  decided_by        text        NOT NULL,   -- the human, e.g. 'Walter Giles (President)' or a staff name
  decided_by_role   text        NOT NULL,   -- board | staff
  source            text        NOT NULL,   -- meeting | email_consent | staff_confirmed | existing_config
  source_ref        text,                   -- meeting date, consent email date, etc.
  decided_at        timestamptz NOT NULL DEFAULT now(),
  recorded_by       text,                   -- staff login that entered it
  supersedes_id     uuid,                   -- previous decision for the same item, if any
  applied_at        timestamptz,            -- set by adoption when written to the live setting
  apply_error       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_onboarding_decision_role   CHECK (decided_by_role IN ('board','staff')),
  CONSTRAINT chk_onboarding_decision_source CHECK (source IN ('meeting','email_consent','staff_confirmed','existing_config'))
);

CREATE INDEX IF NOT EXISTS association_onboarding_decisions_latest
  ON public.association_onboarding_decisions (association_code, item_key, decided_at DESC);
CREATE INDEX IF NOT EXISTS association_onboarding_decisions_unapplied
  ON public.association_onboarding_decisions (association_code)
  WHERE applied_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_onboarding_decisions
  TO anon, authenticated, service_role;
ALTER TABLE public.association_onboarding_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_onboarding_decisions" ON public.association_onboarding_decisions;
CREATE POLICY "service_role_all_association_onboarding_decisions"
  ON public.association_onboarding_decisions FOR ALL TO service_role USING (true);

-- ── Board decision window, per association ───────────────────────────
ALTER TABLE public.board_approval_config
  ADD COLUMN IF NOT EXISTS decision_window_days integer;

NOTIFY pgrst, 'reload schema';
