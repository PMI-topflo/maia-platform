-- =====================================================================
-- tickets — soft-archive support
--
-- Adds tickets.archived_at so staff can hide tickets from the default
-- list without losing the audit trail. The list view filters out
-- archived rows by default and exposes a "Show archived" toggle for
-- recovery / hard-delete from the archive state.
--
-- Hard delete is still done via DELETE on /api/admin/tickets/[id] —
-- the FK CASCADE on ticket_messages, ticket_events, work_order_details,
-- and work_order_attachments handles the cleanup.
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.tickets.archived_at IS
  'Set when staff archives a ticket (soft delete). NULL = active. Archive hides the row from default list queries; restore by setting back to NULL via PATCH; hard-delete via DELETE.';

-- Partial index supports the common "show active only" list filter.
CREATE INDEX IF NOT EXISTS tickets_active_idx
  ON public.tickets (updated_at DESC)
  WHERE archived_at IS NULL;
