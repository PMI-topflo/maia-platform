-- =====================================================================
-- APPLY_recurring_services_bundle.sql   (NOT a migration — won't auto-run)
--
-- One-shot, idempotent bundle to bring the recurring-services subsystem
-- live in a fresh database, in dependency order. Safe to run more than
-- once. Paste the whole thing into the Supabase SQL editor and Run.
--
-- Verified 2026-06-01: recurring_services / service_visits /
-- vendor_employees do NOT exist in the live DB yet — this creates them.
--
-- Covers these registered migrations:
--   1) 20260531_recurring_services.sql       (base tables + grants + RLS)
--   2) 20260531_vendor_language.sql          (office/crew language)
--   3) 20260531_service_visit_agenda.sql     (planned date + crew)
--   4) 20260601_recurring_schedule_anchor.sql(cadence-accurate scheduling)
-- =====================================================================

-- ── 1) Base tables ───────────────────────────────────────────────────
create table if not exists public.vendor_employees (
  id                uuid primary key default gen_random_uuid(),
  cinc_vendor_id    text,
  vendor_name       text        not null,
  name              text        not null,
  phone             text,
  email             text,
  preferred_channel text        not null default 'email' check (preferred_channel in ('email','sms','whatsapp')),
  active            boolean      not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_vendor_employees_vendor on public.vendor_employees(cinc_vendor_id);

create table if not exists public.recurring_services (
  id               bigint generated always as identity primary key,
  association_code text        not null,
  cinc_vendor_id   text,
  vendor_name      text        not null,
  service_type     text        not null,
  cadence          text        not null default 'weekly'  check (cadence in ('weekly','biweekly','monthly')),
  billing_cadence  text        not null default 'monthly'  check (billing_cadence in ('per_visit','weekly','monthly')),
  expected_day     smallint    check (expected_day between 0 and 6),  -- 0=Sun..6=Sat, optional
  office_email     text,
  active           boolean      not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (association_code, cinc_vendor_id, service_type)
);
create index if not exists idx_recurring_services_assoc on public.recurring_services(association_code);

create table if not exists public.service_visits (
  id                   bigint generated always as identity primary key,
  recurring_service_id bigint      references public.recurring_services(id) on delete cascade,
  association_code     text        not null,
  cinc_vendor_id       text,
  vendor_name          text,
  service_type         text,
  week_of              date        not null,  -- Monday of the service week
  status               text        not null default 'expected' check (status in ('expected','confirmed','photos_received','missed')),
  ticket_id            bigint      references public.tickets(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (recurring_service_id, week_of)
);
create index if not exists idx_service_visits_week  on public.service_visits(week_of);
create index if not exists idx_service_visits_assoc on public.service_visits(association_code);

-- ── 2) Language columns ──────────────────────────────────────────────
alter table public.vendor_employees   add column if not exists preferred_language text not null default 'en';
alter table public.recurring_services add column if not exists office_language    text not null default 'en';

-- ── 3) Agenda columns (crew + planned date) ──────────────────────────
alter table public.service_visits
  add column if not exists planned_date          date,
  add column if not exists assigned_employee_ids uuid[] not null default '{}',
  add column if not exists confirmed_at           timestamptz;

-- ── 4) Cadence-accurate scheduling ───────────────────────────────────
alter table public.recurring_services
  add column if not exists schedule_anchor date,
  add column if not exists monthly_day     smallint check (monthly_day between 1 and 31);

-- ── Grants (Supabase drops auto-grants on new tables 2026-10-30) ─────
grant select, insert, update, delete on public.vendor_employees   to anon, authenticated, service_role;
grant select, insert, update, delete on public.recurring_services to anon, authenticated, service_role;
grant select, insert, update, delete on public.service_visits     to anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
alter table public.vendor_employees   enable row level security;
alter table public.recurring_services enable row level security;
alter table public.service_visits     enable row level security;

drop policy if exists service_all on public.vendor_employees;
create policy service_all on public.vendor_employees   for all    to service_role  using (true) with check (true);
drop policy if exists auth_read  on public.vendor_employees;
create policy auth_read  on public.vendor_employees   for select to authenticated using (true);

drop policy if exists service_all on public.recurring_services;
create policy service_all on public.recurring_services for all    to service_role  using (true) with check (true);
drop policy if exists auth_read  on public.recurring_services;
create policy auth_read  on public.recurring_services for select to authenticated using (true);

drop policy if exists service_all on public.service_visits;
create policy service_all on public.service_visits     for all    to service_role  using (true) with check (true);
drop policy if exists auth_read  on public.service_visits;
create policy auth_read  on public.service_visits     for select to authenticated using (true);

-- ── Tell PostgREST to reload the schema cache ────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Sanity check (optional) ──────────────────────────────────────────
-- select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('vendor_employees','recurring_services','service_visits');
