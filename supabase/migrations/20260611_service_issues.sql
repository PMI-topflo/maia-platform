-- =====================================================================
-- 20260611_service_issues.sql
--
-- Service Issue: a resident complaint about a RECURRING service. Instead of a
-- standalone work order, MAIA routes it to the recurring vendor to fix on their
-- next scheduled visit. Vendor reports resolved (+ after-photo) on their agenda
-- visit → Paola 1-click confirms (or it auto-confirms after 5 days) → closed.
-- A repeat complaint re-opens + escalates. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.service_issues (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id             bigint      NOT NULL,        -- originating complaint ticket
  association_code      text        NOT NULL,
  recurring_service_id  bigint,                      -- matched recurring service
  service_visit_id      bigint,                      -- the next visit it rides on
  cinc_vendor_id        text,
  vendor_name           text,
  vendor_email          text,
  service_type          text,
  next_visit_date       date,                        -- expected resolution visit
  issue_summary         text,
  paola_note            text,
  issue_photo_path      text,                        -- resident's "before" photo (work-order-photos)
  resolution_photo_path text,                        -- vendor's "after" photo
  status                text        NOT NULL DEFAULT 'sent',  -- sent | vendor_resolved | confirmed | reopened | escalated
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  vendor_resolved_at    timestamptz,
  confirmed_at          timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_issues_ticket_idx ON public.service_issues (ticket_id);
CREATE INDEX IF NOT EXISTS service_issues_open_idx   ON public.service_issues (status, created_at)
  WHERE status IN ('sent', 'vendor_resolved');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_issues TO anon, authenticated, service_role;
ALTER TABLE public.service_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_service_issues" ON public.service_issues;
CREATE POLICY "service_role_all_service_issues" ON public.service_issues FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
