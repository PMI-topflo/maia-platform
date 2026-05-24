-- =====================================================================
-- 20260523_tickets_unit_board_request.sql
--
-- Lets staff record two ticket-level facts that previously had no
-- column:
--   - unit_number    — the unit / property the ticket relates to
--                      (separate from work_order_details, which only
--                      exists for type='work_order')
--   - is_board_request — true when the ticket originated from a board
--                        member, not an owner/tenant. Surfaces a small
--                        badge on the detail view + can be used for
--                        routing later.
--
-- ALTER ... ADD COLUMN IF NOT EXISTS is instant; idempotent.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS unit_number      text,
  ADD COLUMN IF NOT EXISTS is_board_request boolean NOT NULL DEFAULT false;
