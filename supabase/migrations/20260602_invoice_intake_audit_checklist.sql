-- =====================================================================
-- 20260602_invoice_intake_audit_checklist.sql
-- AP audit checklist on the invoice-intake review screen: the team
-- green-checks each field, then sets the draft to 'ready_to_push'; Karen
-- can only push once it's ready.
--
--   audit_checklist  jsonb  — per-item checked state, e.g.
--                             { "association": true, "vendor": true, ... }
--   audit_ready_by   text   — staff who marked it ready
--   audit_ready_at   timestamptz
--
-- Also widens the status CHECK to add 'ready_to_push'. Idempotent.
-- =====================================================================

alter table public.invoice_intake_drafts
  add column if not exists audit_checklist jsonb       not null default '{}'::jsonb,
  add column if not exists audit_ready_by  text,
  add column if not exists audit_ready_at  timestamptz;

-- Add 'ready_to_push' to the status state machine.
alter table public.invoice_intake_drafts drop constraint if exists invoice_intake_drafts_status_check;
alter table public.invoice_intake_drafts
  add constraint invoice_intake_drafts_status_check check (status in
    ('pending_review','ready_to_push','needs_vendor','duplicate_in_cinc','pushed_to_cinc','rejected'));

NOTIFY pgrst, 'reload schema';
