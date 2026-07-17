-- =====================================================================
-- 20260713_invoice_approvals.sql
--
-- Invoice board approval — mirrors estimate_approvals/estimate_approval_reviews
-- but for AP invoices. Optional, staff-triggered: sending an invoice for
-- board approval does NOT block pushing it to CINC (see
-- app/api/admin/invoices/intake/[id]/push/route.ts, unchanged).
-- On decider approval, the approver's identity is written back into
-- CINC via the existing createInvoiceNote() helper — either immediately
-- (if the invoice was already pushed and has a cinc_invoice_id) or at
-- push time (if not yet pushed).
-- cinc_invoice_id is text, matching invoice_intake_drafts.cinc_invoice_id
-- (CINC's InvoiceID is stored as text there, not numeric).
-- Idempotent. (Requires 20260525_invoice_intake_drafts.sql,
-- 20260713_board_approval_config.sql first.)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.invoice_approvals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_intake_id  bigint NOT NULL REFERENCES public.invoice_intake_drafts(id) ON DELETE CASCADE,
  cinc_invoice_id    text,
  association_code   text NOT NULL,
  vendor_name        text,
  amount             numeric,
  status             text NOT NULL DEFAULT 'pending',
  required           integer NOT NULL DEFAULT 1,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz
);

ALTER TABLE public.invoice_approvals
  DROP CONSTRAINT IF EXISTS chk_ia_status;
ALTER TABLE public.invoice_approvals
  ADD CONSTRAINT chk_ia_status CHECK (status IN ('pending','approved','revision_requested'));

CREATE INDEX IF NOT EXISTS invoice_approvals_intake_idx
  ON public.invoice_approvals (invoice_intake_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_approval_reviews (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id            uuid NOT NULL REFERENCES public.invoice_approvals(id) ON DELETE CASCADE,
  board_member_name      text,
  board_member_email     text,
  member_type            text NOT NULL DEFAULT 'voter',
  token                  text NOT NULL UNIQUE,
  decision               text,
  signature_image        text,
  comments               text,
  sent_at                timestamptz NOT NULL DEFAULT now(),
  decided_at             timestamptz,
  last_reminder_sent_at  timestamptz,
  reminder_count         integer NOT NULL DEFAULT 0
);

ALTER TABLE public.invoice_approval_reviews
  DROP CONSTRAINT IF EXISTS chk_iar_decision;
ALTER TABLE public.invoice_approval_reviews
  ADD CONSTRAINT chk_iar_decision CHECK (decision IS NULL OR decision IN ('approve','revision'));

ALTER TABLE public.invoice_approval_reviews
  DROP CONSTRAINT IF EXISTS chk_iar_member_type;
ALTER TABLE public.invoice_approval_reviews
  ADD CONSTRAINT chk_iar_member_type CHECK (member_type IN ('decider','voter'));

CREATE INDEX IF NOT EXISTS invoice_approval_reviews_approval_idx
  ON public.invoice_approval_reviews (approval_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_approvals        TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_approval_reviews TO anon, authenticated, service_role;

ALTER TABLE public.invoice_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_approval_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_invoice_approvals"        ON public.invoice_approvals;
DROP POLICY IF EXISTS "service_role_all_invoice_approval_reviews" ON public.invoice_approval_reviews;
CREATE POLICY "service_role_all_invoice_approvals"        ON public.invoice_approvals        FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_invoice_approval_reviews" ON public.invoice_approval_reviews FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
