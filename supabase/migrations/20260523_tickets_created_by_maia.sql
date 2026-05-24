-- =====================================================================
-- 20260523_tickets_created_by_maia.sql
--
-- Flag on tickets that distinguishes MAIA AI auto-created+resolved
-- tickets from human-actionable ones. When the MAIA email processor
-- handles a freeform @maia conversation successfully, it opens a
-- ticket with created_by_maia=true and status='resolved' in one shot
-- so the monthly report can count "resolved by MAIA AI" without
-- double-tracking through a separate table.
--
-- ALTER ... ADD COLUMN IF NOT EXISTS is instant; idempotent.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS created_by_maia boolean NOT NULL DEFAULT false;

-- Partial index so the monthly-report aggregation and any future
-- "hide MAIA tickets" toggle can filter cheaply.
CREATE INDEX IF NOT EXISTS tickets_created_by_maia_idx
  ON public.tickets (association_code, resolved_at DESC)
  WHERE created_by_maia = true;
