-- =====================================================================
-- 20260908_invoice_intake_step_tracking.sql
--
-- User direction, 2026-09-08: "make sure to register the user that is
-- pushing every step so we know if the staff member work, show in the
-- top of the card the name and datestamp of each step."
--
-- Two of invoice_intake_drafts' five staff-driven steps already record
-- who/when (audit_ready_by/at from 20260602, pushed_by/pushed_at from
-- the original table) -- but reject and hold never did:
--   - Reject only ever wrote rejected_reason, never who rejected it or
--     when.
--   - Put-on-hold only wrote hold_requested_at, never who requested it.
--   - Release-from-hold recorded NOTHING -- worse, the DELETE handler
--     actively NULLED hold_requested_at on release, destroying the one
--     piece of history that step already had.
--
-- Adds the missing columns. hold_requested_at is no longer cleared on
-- release (see app/api/admin/invoices/intake/[id]/hold/route.ts) --
-- these are single "latest step" columns, same convention as
-- audit_ready_by/pushed_by, not an append-only log.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS rejected_by       text,
  ADD COLUMN IF NOT EXISTS rejected_at       timestamptz,
  ADD COLUMN IF NOT EXISTS hold_requested_by text,
  ADD COLUMN IF NOT EXISTS hold_released_by  text,
  ADD COLUMN IF NOT EXISTS hold_released_at  timestamptz;

NOTIFY pgrst, 'reload schema';
