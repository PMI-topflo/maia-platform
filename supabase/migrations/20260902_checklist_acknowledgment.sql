-- =====================================================================
-- 20260902_checklist_acknowledgment.sql
--
-- Phase 2 of the Checkr-first application pipeline redesign
-- (docs/ROADMAP.md's "Phasing" section, item 2): before an applicant on
-- app/pre-apply/[code] reaches the payment/screening button, they e-sign
-- an acknowledgment covering (a) the full document checklist they were
-- just shown, and (b) the 45-day-from-screening-completion deadline
-- (lib/screening/validity.ts). This is a DISTINCT signature from the
-- existing rules acknowledgment (rules_ack_name/signature_image/
-- rules_ack_ip/signed_at, signed later, after screening, when uploading
-- documents) -- a separate column set rather than reusing those, since
-- both can be signed by the same stakeholder at different points in the
-- same application.
--
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS is instant on an existing
-- table (no backfill, all nullable); idempotent. application_stakeholders
-- already carries its own grants from when it was created -- no GRANT
-- needed here (see CLAUDE.md: existing tables are unaffected by the
-- 2026-10-30 auto-grant removal).
-- =====================================================================

ALTER TABLE public.application_stakeholders
  ADD COLUMN IF NOT EXISTS checklist_ack_name text,
  ADD COLUMN IF NOT EXISTS checklist_ack_signature text,
  ADD COLUMN IF NOT EXISTS checklist_ack_ip text,
  ADD COLUMN IF NOT EXISTS checklist_ack_signed_at timestamptz;

NOTIFY pgrst, 'reload schema';
