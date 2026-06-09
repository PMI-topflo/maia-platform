-- =====================================================================
-- 20260609_estimate_requests.sql
--
-- Vendor estimate-request (RFQ) flow. From a work order, staff request
-- estimates from one or more vendors (scope + photos); each vendor gets a
-- tokenized link to accept-to-quote (with a respond-by date) and upload
-- their estimate. MAIA follows up on vendors who haven't accepted.
--
-- estimate_requests        — one per "ask" on a work order (scope + photos)
-- estimate_request_vendors — one per vendor solicited (link state + bid)
-- Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.estimate_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        bigint      NOT NULL,
  association_code text,
  scope            text        NOT NULL,
  photo_paths      jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- work-order-photos storage paths
  status           text        NOT NULL DEFAULT 'open',
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_estreq_status CHECK (status IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS estimate_requests_ticket_idx ON public.estimate_requests (ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.estimate_request_vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid        NOT NULL REFERENCES public.estimate_requests(id) ON DELETE CASCADE,
  vendor_id        bigint,                       -- CINC VendorId when known
  vendor_name      text,
  vendor_email     text        NOT NULL,
  status           text        NOT NULL DEFAULT 'sent',
  accepted_at      timestamptz,
  respond_by       date,
  estimate_path    text,                         -- uploaded estimate (work-order-photos)
  submitted_at     timestamptz,
  last_followup_at timestamptz,
  followup_count   int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_estreqv_status CHECK (status IN ('sent','accepted','declined','submitted'))
);
CREATE INDEX IF NOT EXISTS estreqv_request_idx ON public.estimate_request_vendors (request_id);
CREATE INDEX IF NOT EXISTS estreqv_followup_idx ON public.estimate_request_vendors (status, created_at) WHERE status = 'sent';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_requests        TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_request_vendors TO anon, authenticated, service_role;
ALTER TABLE public.estimate_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_request_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_estimate_requests"        ON public.estimate_requests;
DROP POLICY IF EXISTS "service_role_all_estimate_request_vendors" ON public.estimate_request_vendors;
CREATE POLICY "service_role_all_estimate_requests"        ON public.estimate_requests        FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_estimate_request_vendors" ON public.estimate_request_vendors FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
