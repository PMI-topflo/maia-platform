-- =====================================================================
-- 20260610_estimate_board_approval.sql
--
-- Board approval of a chosen vendor estimate. Paola sends the comparison
-- to the board; each board member approves (e-signs) or requests a
-- revision; once required_signatures approvals land, it's official.
--   association_board_members.signature_image — saved drawn signature
--     (base64 PNG), captured once and reused on future approvals.
--   estimate_approvals          — one per "send to board" (chosen vendor)
--   estimate_approval_reviews   — one per board member (token + decision)
-- Idempotent. (Requires 20260609_estimate_requests.sql first.)
-- =====================================================================

-- Saved board-member signature (existing table → no grants needed).
ALTER TABLE public.association_board_members
  ADD COLUMN IF NOT EXISTS signature_image text;

CREATE TABLE IF NOT EXISTS public.estimate_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid,
  ticket_id         bigint      NOT NULL,
  association_code  text,
  vendor_request_id uuid,                       -- the chosen estimate_request_vendors row
  vendor_name       text,
  amount            numeric,
  scope             text,
  status            text        NOT NULL DEFAULT 'pending',
  required          int         NOT NULL DEFAULT 1,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CONSTRAINT chk_estapp_status CHECK (status IN ('pending','approved','revision_requested'))
);
CREATE INDEX IF NOT EXISTS estimate_approvals_ticket_idx ON public.estimate_approvals (ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.estimate_approval_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id        uuid        NOT NULL REFERENCES public.estimate_approvals(id) ON DELETE CASCADE,
  board_member_name  text,
  board_member_email text,
  token              text        NOT NULL UNIQUE,
  decision           text,                       -- 'approve' | 'revision' | null
  signature_image    text,
  comments           text,
  sent_at            timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  CONSTRAINT chk_estappr_decision CHECK (decision IS NULL OR decision IN ('approve','revision'))
);
CREATE INDEX IF NOT EXISTS estimate_approval_reviews_approval_idx ON public.estimate_approval_reviews (approval_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_approvals        TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_approval_reviews TO anon, authenticated, service_role;
ALTER TABLE public.estimate_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_approval_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_estimate_approvals"        ON public.estimate_approvals;
DROP POLICY IF EXISTS "service_role_all_estimate_approval_reviews" ON public.estimate_approval_reviews;
CREATE POLICY "service_role_all_estimate_approvals"        ON public.estimate_approvals        FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_estimate_approval_reviews" ON public.estimate_approval_reviews FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
