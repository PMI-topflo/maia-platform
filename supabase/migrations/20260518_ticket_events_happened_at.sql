-- =====================================================================
-- ticket_events — split "when it happened" from "when MAIA logged it"
--
-- Until now, ticket_events.created_at served both purposes. When staff
-- back-fills a change ("I marked it resolved now, but it actually
-- closed yesterday"), they need to record the real-world time without
-- losing the audit fact of when MAIA wrote the row.
--
-- After this migration:
--   - created_at  → unchanged. Always "when MAIA inserted this row".
--   - happened_at → the real-world time of the event. Defaults to NOW()
--                   so existing inserts continue to behave the same.
--                   Staff modals can override to backdate.
--
-- Existing rows get happened_at = created_at so all queries that
-- previously read created_at can switch to happened_at without
-- a behavior change.
-- =====================================================================

ALTER TABLE public.ticket_events
  ADD COLUMN IF NOT EXISTS happened_at timestamptz;

UPDATE public.ticket_events
   SET happened_at = created_at
 WHERE happened_at IS NULL;

ALTER TABLE public.ticket_events
  ALTER COLUMN happened_at SET DEFAULT NOW(),
  ALTER COLUMN happened_at SET NOT NULL;

COMMENT ON COLUMN public.ticket_events.happened_at IS
  'Real-world time the event occurred. Defaults to NOW() when not specified. Staff can backdate via the change-reason modal. When happened_at differs from created_at the UI surfaces "recorded at" separately so the audit trail is honest about backdates.';

CREATE INDEX IF NOT EXISTS ticket_events_happened_at_idx
  ON public.ticket_events (ticket_id, happened_at DESC);
