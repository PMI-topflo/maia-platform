-- =====================================================================
-- 20260523_tickets_requested_by.sql
--
-- Free-text "Requested by" on tickets + work orders — the person who
-- actually asked for the work, separate from contact_name (the
-- person being communicated with). Common cases:
--   - A tenant reports a leak, requested_by = unit owner name.
--   - A board member calls in a violation, requested_by = board name.
--   - Staff logs a request on someone's behalf, requested_by = the
--     real requester, contact_name = the staffer they spoke to.
--
-- Edited from the Details card on /admin/tickets/[id] (same modal
-- that handles Association / Unit / Board-request).
--
-- ALTER ... ADD COLUMN IF NOT EXISTS is instant; idempotent.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS requested_by text;
