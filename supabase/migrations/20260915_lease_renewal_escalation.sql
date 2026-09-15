-- =====================================================================
-- 20260915_lease_renewal_escalation.sql
--
-- Phase 5 of the Checkr-first pipeline redesign (docs/ROADMAP.md): the
-- lease non-renewal escalation. Until now the renewal reminders nagged at
-- T-30 and T-7 and the weekly expired-leases digest nagged forever, with
-- no consequence for an owner who simply never answered.
--
-- Timeline (user direction, 2026-09-15 — this REPLACES the T-30 start
-- drawn in the roadmap's original diagram: "after the end of the lease,
-- they have 15 days to renew, then more 30 days to have the application
-- expired if they don't present any document and the renewal is not
-- active"):
--
--   T (lease end)        T+15                       T+45
--     escalation notice    15-day renew window ends   no document + renewal
--     to the owner;        -> violation-fee decision   not active -> the
--     15-day clock starts     (staff / board / mgr)    application expires
--
-- One row per (association, unit, lease_end) already exists in
-- lease_renewal_checks; these columns hold the escalation state on it.
-- Existing table: no GRANT block needed. Idempotent.
-- =====================================================================

-- ── The escalation notice + the 15-day violation-fee clock ───────────
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS escalated_at              timestamptz;
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS escalation_notice_sent_at timestamptz;
-- Stamped the moment the owner finally answers — the clocks stop, no fee.
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS escalation_resolved_at    timestamptz;

ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_deadline    date;
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_notified_at timestamptz;
-- NULL = staff have not decided yet. true = pre-authorized, charge it if the
-- deadline passes unanswered. false = staff decided not to charge.
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_authorized  boolean;
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_decided_at  timestamptz;
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_decided_by  text;
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_amount      numeric(10,2);
-- MAIA cannot post a charge to CINC (lib/integrations/cinc.ts reads ledgers
-- only). This stamps the moment AR was told to post it, not a CINC write.
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS violation_fee_applied_at  timestamptz;

-- ── The 30 further days, then the application expires ────────────────
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS grace_deadline            date;
-- renewal_active | expired_no_documents | new_application_required
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS grace_outcome             text;
ALTER TABLE public.lease_renewal_checks ADD COLUMN IF NOT EXISTS grace_outcome_at          timestamptz;

ALTER TABLE public.lease_renewal_checks DROP CONSTRAINT IF EXISTS chk_lrc_grace_outcome;
ALTER TABLE public.lease_renewal_checks ADD CONSTRAINT chk_lrc_grace_outcome
  CHECK (grace_outcome IS NULL OR grace_outcome IN ('renewal_active','expired_no_documents','new_application_required'));

-- The staff screen lists escalated rows newest-first; the cron scans the
-- two deadlines.
CREATE INDEX IF NOT EXISTS lease_renewal_checks_escalated_idx ON public.lease_renewal_checks (escalated_at DESC) WHERE escalated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS lease_renewal_checks_fee_deadline_idx ON public.lease_renewal_checks (violation_fee_deadline) WHERE escalation_resolved_at IS NULL;

NOTIFY pgrst, 'reload schema';
