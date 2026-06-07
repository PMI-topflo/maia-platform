-- =====================================================================
-- 20260607_wo_photos_to_cinc.sql
--
-- Push work-order photos MAIA → CINC (companion to docs/specs/wo-photos-to-cinc.md).
--
-- 1. cinc_pushed_at on work_order_attachments — idempotency stamp so a
--    MAIA-origin photo (source 'email' / 'staff_upload') is uploaded into
--    the linked CINC work order exactly once. NULL = not yet pushed.
-- 2. Widen the integration_outbox entity_type CHECK so the new
--    ('work_order_attachment','push_photo') outbox event is accepted.
--
-- Idempotent: safe to re-run.
-- =====================================================================

ALTER TABLE public.work_order_attachments
  ADD COLUMN IF NOT EXISTS cinc_pushed_at timestamptz;

ALTER TABLE public.integration_outbox
  DROP CONSTRAINT IF EXISTS chk_outbox_entity_type;
ALTER TABLE public.integration_outbox
  ADD CONSTRAINT chk_outbox_entity_type
  CHECK (entity_type IN ('ticket', 'ticket_message', 'work_order_attachment'));

NOTIFY pgrst, 'reload schema';
