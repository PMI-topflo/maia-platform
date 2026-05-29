-- =====================================================================
-- 20260529_association_safety_inspections.sql
--
-- I4 — Florida-specific structural-safety inspection tracking:
--   SIRS      Structural Integrity Reserve Study (SB 4-D / §718.112(2)(g))
--   milestone Milestone Inspection (§553.899) — 30yr (25yr if coastal)
--   wind_mitigation  Wind Mitigation report (insurance credit)
--   roof      Roof condition inspection
--
-- One row per (association, inspection_type, building) version. Because
-- the app has no per-building year-built / stories data, those live on
-- the inspection row itself — they drive (a) whether SIRS/Milestone even
-- apply (3+ stories) and (b) the suggested next-due deadline (see
-- lib/association-safety.ts). A renewal supersedes the prior row the same
-- way insurance/documents version: insert new active, archive the old.
--
-- next_due_date is what the compliance cron + dashboard "Inspections Due"
-- tracker (I7) key on. It can be staff-entered or prefilled from the
-- suggested-deadline helper.
--
-- All statements idempotent / re-runnable.
-- =====================================================================

create table if not exists public.association_safety_inspections (
  id                   bigint generated always as identity primary key,
  association_code     text        not null,
  -- one of lib/association-safety.ts INSPECTION_TYPES
  -- (sirs, milestone, wind_mitigation, roof)
  inspection_type      text        not null,
  -- Optional building identifier for multi-building associations
  -- (e.g. "Building A", "North Tower"). NULL = single/whole association.
  building_label       text,
  year_built           int,
  stories              int,
  -- Milestone clock is 25yr instead of 30yr within 3 miles of the coast.
  coastal              boolean     not null default false,
  last_completed_date  date,
  next_due_date        date,
  -- Engineering / inspection firm that performed (or will perform) it.
  provider             text,
  -- Report PDF in the association-documents bucket under
  -- <CODE>/safety/<inspection_type>/...
  report_storage_path  text,
  report_filename      text,
  report_mime_type     text,
  report_file_size_bytes bigint,
  waived               boolean     not null default false,
  waived_reason        text,
  notes                text,
  archived_at          timestamptz,
  archived_by_email    text,
  created_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_assoc_safe_code on public.association_safety_inspections(association_code);
create index if not exists idx_assoc_safe_type on public.association_safety_inspections(inspection_type);
create index if not exists idx_assoc_safe_due  on public.association_safety_inspections(next_due_date);
create index if not exists idx_assoc_safe_active on public.association_safety_inspections(archived_at) where archived_at is null;

-- At most one active row per (association, inspection_type, building).
-- coalesce(building_label,'') so the single-building NULL case is unique.
create unique index if not exists uq_assoc_safe_active
  on public.association_safety_inspections(association_code, inspection_type, coalesce(building_label, ''))
  where archived_at is null;

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.association_safety_inspections;
create trigger set_updated_at before update on public.association_safety_inspections
  for each row execute function public.tg_set_updated_at();

grant select, insert, update, delete on public.association_safety_inspections
  to anon, authenticated, service_role;

alter table public.association_safety_inspections enable row level security;

drop policy if exists service_all on public.association_safety_inspections;
create policy service_all on public.association_safety_inspections
  for all to service_role using (true) with check (true);

drop policy if exists auth_read on public.association_safety_inspections;
create policy auth_read on public.association_safety_inspections
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Extend compliance_alerts.alert_type CHECK to the FULL union of every
-- alert type the cron emits (lease / unit-insurance / cou / violation /
-- association-insurance / inspection). Drops any existing check on
-- alert_type first so re-running stays idempotent and order-independent
-- with the insurance migration.
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
      'inspection_due','inspection_overdue'
    ));
end $$;
