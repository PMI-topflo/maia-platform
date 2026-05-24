-- =====================================================================
-- 20260525_tickets_category.sql
--
-- Adds a category field for tickets that aren't work orders — Resident
-- Support, Violations & Compliance, Architectural Review, etc. The
-- canonical list lives in lib/ticket-categories.ts; this column stores
-- the human-readable label so the DB stays self-describing for ad-hoc
-- reporting / exports.
--
-- Work orders (type='work_order') already have work_order_type_name —
-- this column is the parallel concept for plain tickets.
--
-- ALTER ... ADD COLUMN IF NOT EXISTS is instant; idempotent.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS ticket_category text;

-- Partial index so future "filter by category" listings stay fast.
CREATE INDEX IF NOT EXISTS tickets_category_idx
  ON public.tickets (ticket_category, updated_at DESC)
  WHERE ticket_category IS NOT NULL;
