-- =====================================================================
-- work_order_attachments — photos/files attached to a work order
--
-- Three sources, all stored in the same `work-order-photos` bucket:
--   - 'cinc'         → mirrored from CINC's /workOrderAttachments
--                      endpoint on first view of the ticket detail.
--                      (cinc_workorder_id, cinc_filename, cinc_created_date
--                      are required for dedupe.)
--   - 'email'        → photos arriving on a Gmail webhook reply that
--                      references the WO (task 2, future work).
--   - 'staff_upload' → direct upload from the admin UI (task 3,
--                      future work). uploaded_by_email captures who.
--
-- Mirror policy: rows are append-only. To replace a photo, archive the
-- old row by inserting a new one — UI surfaces only the latest by
-- created_at desc for now. (No archived_at column yet; add if needed.)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.work_order_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           bigint      NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  cinc_workorder_id   integer,
  source              text        NOT NULL CHECK (source IN ('cinc', 'email', 'staff_upload')),
  storage_path        text        NOT NULL,
  filename            text        NOT NULL,
  mime_type           text        NOT NULL,
  file_size_bytes     bigint      NOT NULL,
  cinc_filename       text,
  cinc_created_date   timestamptz,
  uploaded_by_email   text,
  mirrored_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.work_order_attachments.source IS
  'Origin of the file: cinc (mirrored from CINC API), email (Gmail webhook), staff_upload (admin UI).';
COMMENT ON COLUMN public.work_order_attachments.storage_path IS
  'Object key inside the work-order-photos bucket. Format: wo-<ticket_id>/<id>-<filename>.';
COMMENT ON COLUMN public.work_order_attachments.cinc_filename IS
  'Original FileName returned by CINC (e.g. file1a42d81c.png). Used together with cinc_created_date for dedupe on re-mirror.';
COMMENT ON COLUMN public.work_order_attachments.cinc_created_date IS
  'CreatedDate that CINC reported for this attachment. NOT the time we mirrored it (that is mirrored_at).';

CREATE INDEX IF NOT EXISTS woa_ticket_idx
  ON public.work_order_attachments (ticket_id, created_at DESC);

-- Dedupe key for CINC-sourced photos so re-running the mirror is a
-- no-op when CINC has nothing new.
CREATE UNIQUE INDEX IF NOT EXISTS woa_cinc_dedupe_idx
  ON public.work_order_attachments (ticket_id, cinc_filename, cinc_created_date)
  WHERE source = 'cinc';

ALTER TABLE public.work_order_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_work_order_attachments"
  ON public.work_order_attachments FOR ALL TO service_role USING (true);
