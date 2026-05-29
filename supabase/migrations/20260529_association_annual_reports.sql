-- =====================================================================
-- 20260529_association_annual_reports.sql
--
-- I8 — Florida Sunbiz annual-report filing tracker.
--
-- Every FL corporation (each HOA/condo association) must file an annual
-- report with the Division of Corporations by MAY 1. Miss it and a
-- $400 late fee applies (after May 1), and the entity is administratively
-- DISSOLVED if still unfiled by the 4th Friday of September. Several of
-- PMI's associations have been admin-dissolved historically — this is
-- pure money + existential risk, so MAIA tracks it.
--
-- The associations table already holds entity-level Sunbiz facts
-- (sunbiz_document_number, sunbiz_status, date_filed = original
-- incorporation date, fei_ein_number). This table adds the per-YEAR
-- filing record so we can tell "has THIS year's annual report been
-- filed?" — one row per (association, report_year).
--
-- This is a 📝 metadata tracker — no document file is stored; the
-- confirmation number from Sunbiz is the artifact. See
-- COMPLIANCE_TRACKING.md.
--
-- All statements idempotent / re-runnable.
-- =====================================================================

create table if not exists public.association_annual_reports (
  id                   bigint generated always as identity primary key,
  association_code     text        not null,
  report_year          int         not null,
  -- NULL until staff records the filing. Presence => filed.
  filed_date           date,
  confirmation_number  text,
  -- Sunbiz annual-report fee actually paid (base $61.25; +$400 late).
  fee_paid_usd         numeric(8,2),
  filed_by_email       text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (association_code, report_year)
);

create index if not exists idx_annual_reports_code on public.association_annual_reports(association_code);
create index if not exists idx_annual_reports_year on public.association_annual_reports(report_year);

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.association_annual_reports;
create trigger set_updated_at before update on public.association_annual_reports
  for each row execute function public.tg_set_updated_at();

grant select, insert, update, delete on public.association_annual_reports
  to anon, authenticated, service_role;

alter table public.association_annual_reports enable row level security;

drop policy if exists service_all on public.association_annual_reports;
create policy service_all on public.association_annual_reports
  for all to service_role using (true) with check (true);

drop policy if exists auth_read on public.association_annual_reports;
create policy auth_read on public.association_annual_reports
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Extend compliance_alerts.alert_type CHECK to the full union incl. the
-- two Sunbiz alert types. Drops any existing check on alert_type first
-- (idempotent + order-independent with the other migrations).
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'compliance_alerts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%alert_type%'
  loop
    execute format('alter table public.compliance_alerts drop constraint %I', c.conname);
  end loop;

  alter table public.compliance_alerts
    add constraint compliance_alerts_alert_type_check
    check (alert_type in (
      'lease_expiring','lease_expired',
      'insurance_expiring','insurance_expired',
      'violation_due','violation_overdue',
      'cou_expiring','cou_expired',
      'assoc_insurance_expiring','assoc_insurance_expired',
      'inspection_due','inspection_overdue',
      'sunbiz_due','sunbiz_overdue'
    ));
end $$;
