-- =====================================================================
-- 20260530_scheduled_payments.sql
--
-- Manual FUTURE payments for the reconciliation "Upcoming Payments"
-- section — the bottom part of Karen/Isabela's spreadsheet where they
-- list known future outflows (insurance installments, future
-- assessments, anything MAIA can't infer from CINC or history).
--
-- One row = one expected payment in one month. Installment plans (e.g.
-- "insurance $500/mo for 6 months") create six rows sharing a series_id.
-- A row stays pending — and carries forward into later months' views —
-- until it's marked paid (status='paid') or cancelled.
--
-- The CINC approved-unpaid invoices and MAIA recurring estimates that
-- also appear in the Upcoming section are computed live (CINC openInvoices
-- + the cash-flow forecast), NOT stored here — this table is only the
-- manual entries.
--
-- All statements idempotent / re-runnable.
-- =====================================================================

create table if not exists public.scheduled_payments (
  id                bigint generated always as identity primary key,
  association_code  text        not null,
  -- Optional: which bank account it's expected to draw from.
  bank_account_id   bigint,
  -- Month the payment is expected, 'YYYY-MM'. The Upcoming section for
  -- month M shows pending rows with due_month <= M (carry-forward).
  due_month         text        not null,
  due_date          date,
  vendor_payee      text,
  description       text,
  -- insurance | assessment | utility | vendor | tax | other (free text)
  category          text,
  -- Positive magnitude; `direction` says in/out. Most future entries are
  -- outflows (payments), but allow inflows (expected deposits) too.
  amount            numeric(14,2) not null,
  direction         text        not null default 'outflow'
                      check (direction in ('outflow','inflow')),
  -- Groups the rows of one installment plan so they can be managed/
  -- deleted together.
  series_id         uuid,
  status            text        not null default 'pending'
                      check (status in ('pending','paid','cancelled')),
  paid_date         date,
  notes             text,
  created_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_sched_pay_assoc  on public.scheduled_payments(association_code);
create index if not exists idx_sched_pay_month  on public.scheduled_payments(due_month);
create index if not exists idx_sched_pay_status on public.scheduled_payments(status);
create index if not exists idx_sched_pay_series on public.scheduled_payments(series_id);

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.scheduled_payments;
create trigger set_updated_at before update on public.scheduled_payments
  for each row execute function public.tg_set_updated_at();

grant select, insert, update, delete on public.scheduled_payments
  to anon, authenticated, service_role;

alter table public.scheduled_payments enable row level security;

drop policy if exists service_all on public.scheduled_payments;
create policy service_all on public.scheduled_payments
  for all to service_role using (true) with check (true);

drop policy if exists auth_read on public.scheduled_payments;
create policy auth_read on public.scheduled_payments
  for select to authenticated using (true);

NOTIFY pgrst, 'reload schema';
