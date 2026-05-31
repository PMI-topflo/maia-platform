-- =====================================================================
-- 20260531_recurring_services.sql
-- Recurring vendor services (landscaping, pool, janitorial, pest control)
-- per association, the vendor's crew, and the per-week service visits.
--
-- A weekly visit becomes its own work order (ticket_id) so photos +
-- reports attach per-visit and weekly coverage is reportable.
-- Idempotent; new public tables get explicit GRANT + RLS.
-- =====================================================================

-- Vendor crew — who actually shows up (gets the weekly upload link).
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

-- Fixed recurring service per (association × vendor × service type).
create table if not exists public.recurring_services (
  id               bigint generated always as identity primary key,
  association_code text        not null,
  cinc_vendor_id   text,
  vendor_name      text        not null,
  service_type     text        not null,
  cadence          text        not null default 'weekly' check (cadence in ('weekly','biweekly','monthly')),       -- how often they SERVICE (drives weekly visits/photos)
  billing_cadence  text        not null default 'monthly' check (billing_cadence in ('per_visit','weekly','monthly')), -- how the vendor BILLS (one monthly invoice covers the month's visits)
  expected_day     smallint    check (expected_day between 0 and 6),  -- 0=Sun..6=Sat, optional
  office_email     text,       -- vendor office address for the Friday agenda email
  active           boolean      not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (association_code, cinc_vendor_id, service_type)
);
create index if not exists idx_recurring_services_assoc on public.recurring_services(association_code);

-- The actual per-week visit instances generated from the schedule.
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

-- Grants + RLS (Supabase removes auto-grants on new tables 2026-10-30).
grant select, insert, update, delete on public.vendor_employees   to anon, authenticated, service_role;
grant select, insert, update, delete on public.recurring_services to anon, authenticated, service_role;
grant select, insert, update, delete on public.service_visits     to anon, authenticated, service_role;

alter table public.vendor_employees   enable row level security;
alter table public.recurring_services enable row level security;
alter table public.service_visits     enable row level security;

drop policy if exists service_all on public.vendor_employees;
create policy service_all on public.vendor_employees   for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.vendor_employees;
create policy auth_read on public.vendor_employees   for select to authenticated using (true);

drop policy if exists service_all on public.recurring_services;
create policy service_all on public.recurring_services for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.recurring_services;
create policy auth_read on public.recurring_services for select to authenticated using (true);

drop policy if exists service_all on public.service_visits;
create policy service_all on public.service_visits     for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.service_visits;
create policy auth_read on public.service_visits     for select to authenticated using (true);

NOTIFY pgrst, 'reload schema';
