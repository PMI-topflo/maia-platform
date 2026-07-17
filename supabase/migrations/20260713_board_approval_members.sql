-- =====================================================================
-- 20260713_board_approval_members.sql
--
-- board_approval_members — which association_board_members sit on the
-- committee for a given approval purpose, and whether their decision is
-- binding (decider) or advisory (voter). A decider's decision counts
-- toward board_approval_config.required_signatures; a voter's decision
-- is recorded but never closes the approval on its own.
-- Backfills application/estimate committees from today's active board
-- members (first by sort_order = decider, rest = voter) so existing
-- behavior is preserved exactly. invoice starts empty — staff must
-- configure a committee for it before first use.
-- Idempotent. (Requires 20260504_board_review_workflow.sql,
-- 20260713_board_approval_config.sql first.)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.board_approval_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text NOT NULL,
  purpose          text NOT NULL,
  board_member_id  uuid NOT NULL REFERENCES public.association_board_members(id) ON DELETE CASCADE,
  member_type      text NOT NULL DEFAULT 'voter',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bam_assoc_purpose_member UNIQUE (association_code, purpose, board_member_id)
);

ALTER TABLE public.board_approval_members
  DROP CONSTRAINT IF EXISTS chk_bam_purpose_values;
ALTER TABLE public.board_approval_members
  ADD CONSTRAINT chk_bam_purpose_values CHECK (purpose IN ('application','invoice','estimate'));

ALTER TABLE public.board_approval_members
  DROP CONSTRAINT IF EXISTS chk_bam_type;
ALTER TABLE public.board_approval_members
  ADD CONSTRAINT chk_bam_type CHECK (member_type IN ('decider','voter'));

CREATE INDEX IF NOT EXISTS board_approval_members_lookup_idx
  ON public.board_approval_members (association_code, purpose);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_approval_members TO anon, authenticated, service_role;

ALTER TABLE public.board_approval_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_board_approval_members" ON public.board_approval_members;
CREATE POLICY "service_role_all_board_approval_members"
  ON public.board_approval_members FOR ALL TO service_role USING (true);

-- Backfill deciders: first active member per association (by
-- sort_order, tie-broken by created_at), for application + estimate.
INSERT INTO public.board_approval_members (association_code, purpose, board_member_id, member_type)
SELECT DISTINCT ON (m.association_code, p.purpose)
  m.association_code, p.purpose, m.id, 'decider'
FROM public.association_board_members m
CROSS JOIN (VALUES ('application'), ('estimate')) AS p(purpose)
WHERE m.active
ORDER BY m.association_code, p.purpose, m.sort_order, m.created_at
ON CONFLICT (association_code, purpose, board_member_id) DO NOTHING;

-- Backfill voters: every other active member per association, for the
-- same two purposes. The unique constraint + DO NOTHING means the
-- member already inserted as decider above is skipped here, not
-- overwritten.
INSERT INTO public.board_approval_members (association_code, purpose, board_member_id, member_type)
SELECT m.association_code, p.purpose, m.id, 'voter'
FROM public.association_board_members m
CROSS JOIN (VALUES ('application'), ('estimate')) AS p(purpose)
WHERE m.active
ON CONFLICT (association_code, purpose, board_member_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
