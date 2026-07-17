-- =====================================================================
-- 20260713_board_approval_config.sql
--
-- board_approval_config — per-purpose (application/invoice/estimate)
-- board-approval settings, replacing the single shared
-- association_config.required_signatures/approval_letter_template that
-- both the application and estimate approval flows used to read (so
-- e.g. an association couldn't require 2 signatures for applications
-- but only 1 for estimates). association_config's old columns are left
-- in place (unused going forward, not dropped) so this migration is
-- purely additive.
-- Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.board_approval_config (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code          text NOT NULL,
  purpose                   text NOT NULL,
  required_signatures       integer NOT NULL DEFAULT 1,
  approval_letter_template  text,
  reminder_cadence          text NOT NULL DEFAULT 'off',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bac_assoc_purpose UNIQUE (association_code, purpose)
);

-- Separate CHECK constraints (some Postgres versions reject inline
-- CHECK + UNIQUE on the same line cleanly across pg_dump round-trips).
ALTER TABLE public.board_approval_config
  DROP CONSTRAINT IF EXISTS chk_bac_purpose_values;
ALTER TABLE public.board_approval_config
  ADD CONSTRAINT chk_bac_purpose_values CHECK (purpose IN ('application','invoice','estimate'));

ALTER TABLE public.board_approval_config
  DROP CONSTRAINT IF EXISTS chk_bac_cadence;
ALTER TABLE public.board_approval_config
  ADD CONSTRAINT chk_bac_cadence CHECK (reminder_cadence IN ('off','every_2_days','every_3_days','weekly'));

CREATE INDEX IF NOT EXISTS board_approval_config_assoc_idx
  ON public.board_approval_config (association_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_approval_config TO anon, authenticated, service_role;

ALTER TABLE public.board_approval_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_board_approval_config" ON public.board_approval_config;
CREATE POLICY "service_role_all_board_approval_config"
  ON public.board_approval_config FOR ALL TO service_role USING (true);

-- Backfill: give every association with an association_config row a
-- starting config for all 3 purposes. application/estimate inherit the
-- existing shared required_signatures/approval_letter_template so
-- current behavior doesn't change; invoice starts at defaults since it
-- never existed before.
INSERT INTO public.board_approval_config (association_code, purpose, required_signatures, approval_letter_template)
SELECT association_code, 'application', COALESCE(required_signatures, 1), approval_letter_template
FROM public.association_config
ON CONFLICT (association_code, purpose) DO NOTHING;

INSERT INTO public.board_approval_config (association_code, purpose, required_signatures, approval_letter_template)
SELECT association_code, 'estimate', COALESCE(required_signatures, 1), approval_letter_template
FROM public.association_config
ON CONFLICT (association_code, purpose) DO NOTHING;

INSERT INTO public.board_approval_config (association_code, purpose, required_signatures)
SELECT association_code, 'invoice', 1
FROM public.association_config
ON CONFLICT (association_code, purpose) DO NOTHING;

NOTIFY pgrst, 'reload schema';
