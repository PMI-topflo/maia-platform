-- =====================================================================
-- 20260530_upcoming_lifecycle.sql
--
-- Lifecycle controls for the reconciliation "Upcoming Payments" section:
--
--   1. recurring_estimate_dismissals — MAIA recurring estimates are
--      recomputed live from payment history, so there's nothing to edit.
--      When staff judge an estimate wrong/unwanted, we record a dismissal
--      (keyed by the recurring fingerprint) so it stops reappearing. To
--      "edit" one, staff convert it to a manual entry (which IS editable)
--      and dismiss the estimate.
--
--   2. scheduled_payments.matched_gl_trans_id — links a manual future
--      payment to the actual posted CINC transaction so the recon sync
--      can auto-mark it paid (it drops off the pending list) instead of
--      staff deleting it by hand.
--
-- Idempotent.
-- =====================================================================

create table if not exists public.recurring_estimate_dismissals (
  id                 bigint generated always as identity primary key,
  association_code   text        not null,
  vendor_key         text        not null,
  dismissed_by_email text,
  created_at         timestamptz not null default now(),
  unique (association_code, vendor_key)
);

create index if not exists idx_recur_dismiss_assoc on public.recurring_estimate_dismissals(association_code);

grant select, insert, update, delete on public.recurring_estimate_dismissals
  to anon, authenticated, service_role;

alter table public.recurring_estimate_dismissals enable row level security;
drop policy if exists service_all on public.recurring_estimate_dismissals;
create policy service_all on public.recurring_estimate_dismissals
  for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.recurring_estimate_dismissals;
create policy auth_read on public.recurring_estimate_dismissals
  for select to authenticated using (true);

alter table public.scheduled_payments
  add column if not exists matched_gl_trans_id bigint;

NOTIFY pgrst, 'reload schema';
