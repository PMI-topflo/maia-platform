-- =====================================================================
-- Stable CINC primary-key references on our owners + board-members
-- tables. Lets the /admin/cinc-sync importer match rows deterministically
-- across re-runs even when unit numbers get renumbered or names change
-- spelling on either side.
--
--   owners.cinc_property_id              = CINC PropertyID (per unit)
--   association_board_members.cinc_board_member_id = CINC BoardMemberId
--
-- Both are nullable so legacy rows with no CINC linkage continue to work.
-- =====================================================================

ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS cinc_property_id BIGINT;

ALTER TABLE public.association_board_members
  ADD COLUMN IF NOT EXISTS cinc_board_member_id BIGINT;

-- Partial indexes — only index rows that actually have the upstream ref,
-- which is most of the lookup workload (preview / apply checks "is this
-- CINC id already in our DB?" before deciding insert vs update).
CREATE INDEX IF NOT EXISTS idx_owners_cinc_property_id
  ON public.owners (cinc_property_id)
  WHERE cinc_property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abm_cinc_board_member_id
  ON public.association_board_members (cinc_board_member_id)
  WHERE cinc_board_member_id IS NOT NULL;
