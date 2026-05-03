-- =====================================================================
-- maia-platform — Unit-level compliance tracking
-- Migration: 2026-05-03_unit_compliance_tracking
--
-- Adds: per-unit folder registry, leases, insurance, violations,
-- City of Lauderhill Certificate of Use tracking, and alert queue.
--
-- Foreign key everywhere: account_number (e.g. 'MANXI103', 'GVH1235')
-- This matches your existing Cinc-imported homeowners table.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Per-unit Drive folder registry
-- ---------------------------------------------------------------------
create table if not exists public.unit_drive_folders (
  id              bigint generated always as identity primary key,
  account_number  text        not null,
  association_code text       not null,
  folder_type     text        not null check (folder_type in (
                              'unit_root',
                              'lease_applications',
                              'purchase_applications',
                              'violations',
                              'insurance',
                              'lauderhill_cou'
                            )),
  drive_folder_id text        not null,
  drive_url       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_number, folder_type)
);

create index if not exists idx_udf_account on public.unit_drive_folders(account_number);
create index if not exists idx_udf_assoc   on public.unit_drive_folders(association_code);

-- ---------------------------------------------------------------------
-- 2. Unit leases (one row per lease cycle; new lease = new row)
-- ---------------------------------------------------------------------
create table if not exists public.unit_leases (
  id                  bigint generated always as identity primary key,
  account_number      text        not null,
  association_code    text        not null,
  tenant_name         text,
  tenant_email        text,
  tenant_phone        text,
  lease_start_date    date,
  lease_end_date      date,
  application_status  text        not null default 'active'
                       check (application_status in ('pending','approved','active','expired','terminated','renewed')),
  source_pdf_url      text,                         -- Drive URL of the lease PDF
  source_drive_file_id text,
  extracted_by        text        check (extracted_by in ('gemini','claude','manual')),
  extracted_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_leases_account on public.unit_leases(account_number);
create index if not exists idx_leases_end     on public.unit_leases(lease_end_date);
create index if not exists idx_leases_status  on public.unit_leases(application_status);

-- ---------------------------------------------------------------------
-- 3. Unit purchases / resales
-- ---------------------------------------------------------------------
create table if not exists public.unit_purchases (
  id                  bigint generated always as identity primary key,
  account_number      text        not null,
  association_code    text        not null,
  buyer_name          text,
  buyer_email         text,
  buyer_phone         text,
  application_date    date,
  closing_date        date,
  application_status  text        not null default 'pending'
                       check (application_status in ('pending','board_review','approved','denied','closed')),
  source_pdf_url      text,
  source_drive_file_id text,
  extracted_by        text        check (extracted_by in ('gemini','claude','manual')),
  extracted_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_purchases_account on public.unit_purchases(account_number);

-- ---------------------------------------------------------------------
-- 4. Unit insurance policies
-- ---------------------------------------------------------------------
create table if not exists public.unit_insurance (
  id                  bigint generated always as identity primary key,
  account_number      text        not null,
  association_code    text        not null,
  carrier             text,
  policy_number       text,
  effective_date      date,
  expiration_date     date,
  premium_usd         numeric(10,2),
  source_pdf_url      text,
  source_drive_file_id text,
  wind_mitigation_url text,
  appraisal_url       text,
  extracted_by        text        check (extracted_by in ('gemini','claude','manual')),
  extracted_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_insurance_account on public.unit_insurance(account_number);
create index if not exists idx_insurance_exp     on public.unit_insurance(expiration_date);

-- ---------------------------------------------------------------------
-- 5. Unit violations
-- ---------------------------------------------------------------------
create table if not exists public.unit_violations (
  id                  bigint generated always as identity primary key,
  account_number      text        not null,
  association_code    text        not null,
  violation_type      text,
  description         text,
  issued_date         date,
  resolution_due_date date,
  resolved_date       date,
  status              text        not null default 'open'
                       check (status in ('open','in_progress','resolved','escalated','fined')),
  source_pdf_url      text,
  source_drive_file_id text,
  extracted_by        text        check (extracted_by in ('gemini','claude','manual')),
  extracted_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_violations_account on public.unit_violations(account_number);
create index if not exists idx_violations_status  on public.unit_violations(status);
create index if not exists idx_violations_due     on public.unit_violations(resolution_due_date);

-- ---------------------------------------------------------------------
-- 6. City of Lauderhill Certificate of Use
-- (annual renewal — Lauderhill specific, but schema is reusable for
-- other cities by adding rows with different `city` values)
-- ---------------------------------------------------------------------
create table if not exists public.unit_certificate_of_use (
  id                  bigint generated always as identity primary key,
  account_number      text        not null,
  association_code    text        not null,
  city                text        not null default 'Lauderhill',
  certificate_number  text,
  issue_date          date,
  expiration_date     date,
  status              text        not null default 'active'
                       check (status in ('active','expired','pending_renewal','revoked','not_required')),
  renewal_fee_usd     numeric(8,2),
  source_pdf_url      text,
  source_drive_file_id text,
  extracted_by        text        check (extracted_by in ('gemini','claude','manual')),
  extracted_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (account_number, city, expiration_date)
);

create index if not exists idx_cou_account on public.unit_certificate_of_use(account_number);
create index if not exists idx_cou_exp     on public.unit_certificate_of_use(expiration_date);
create index if not exists idx_cou_city    on public.unit_certificate_of_use(city);

-- ---------------------------------------------------------------------
-- 7. Compliance alerts queue (filled by daily cron)
-- ---------------------------------------------------------------------
create table if not exists public.compliance_alerts (
  id                  bigint generated always as identity primary key,
  account_number      text        not null,
  association_code    text        not null,
  alert_type          text        not null check (alert_type in (
                       'lease_expiring','lease_expired',
                       'insurance_expiring','insurance_expired',
                       'violation_due','violation_overdue',
                       'cou_expiring','cou_expired'
                      )),
  severity            text        not null check (severity in ('warning','urgent','critical')),
  reference_id        bigint,                      -- FK to underlying record id
  reference_table     text,                        -- e.g. 'unit_leases'
  expiration_date     date,
  days_delta          int,                         -- negative = past due
  message             text        not null,
  notified_60d        boolean     not null default false,
  notified_30d        boolean     not null default false,
  notified_expired    boolean     not null default false,
  acknowledged_at     timestamptz,
  acknowledged_by     text,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_alerts_account  on public.compliance_alerts(account_number);
create index if not exists idx_alerts_type     on public.compliance_alerts(alert_type);
create index if not exists idx_alerts_severity on public.compliance_alerts(severity);
create index if not exists idx_alerts_active   on public.compliance_alerts(resolved_at) where resolved_at is null;

-- ---------------------------------------------------------------------
-- 7b. Drive pre-migration snapshot (rollback safety)
-- Captures the original folder names before the bootstrap script
-- renames them. One row per existing folder per snapshot run.
-- ---------------------------------------------------------------------
create table if not exists public.drive_pre_migration_snapshot (
  id                  bigint generated always as identity primary key,
  association_code    text        not null,
  drive_folder_id     text        not null,
  original_name       text        not null,
  parent_folder_id    text        not null,
  snapshotted_at      timestamptz not null default now()
);

create index if not exists idx_snapshot_assoc on public.drive_pre_migration_snapshot(association_code);

-- ---------------------------------------------------------------------
-- 8. Indexer audit log (every Drive scan)
-- ---------------------------------------------------------------------
create table if not exists public.drive_indexer_log (
  id                  bigint generated always as identity primary key,
  association_code    text        not null,
  folder_scanned      text,                        -- Drive folder ID
  files_seen          int         not null default 0,
  files_processed     int         not null default 0,
  files_skipped       int         not null default 0,
  errors              int         not null default 0,
  error_details       jsonb,
  ai_provider         text        check (ai_provider in ('gemini','claude')),
  cost_usd            numeric(10,4),
  duration_ms         int,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists idx_indexer_assoc on public.drive_indexer_log(association_code);
create index if not exists idx_indexer_started on public.drive_indexer_log(started_at desc);

-- ---------------------------------------------------------------------
-- 9. Master associations exclusion list
-- ---------------------------------------------------------------------
create table if not exists public.association_config (
  association_code    text        primary key,
  is_master           boolean     not null default false,
  city                text,
  requires_cou        boolean     not null default false,  -- Lauderhill = true
  cou_renewal_month   int         check (cou_renewal_month between 1 and 12),
  cou_annual_fee_usd  numeric(8,2),
  hide_application_forms boolean  not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Seed: master associations (no application forms)
insert into public.association_config (association_code, is_master, hide_application_forms, notes)
values
  ('LCLUB', true, true,  'Lakeview California Club — master association'),
  ('VPREC', true, true,  'Venetian Park Recreation — master association')
on conflict (association_code) do update set
  is_master = excluded.is_master,
  hide_application_forms = excluded.hide_application_forms,
  notes = excluded.notes,
  updated_at = now();

-- Seed: MANXI requires Lauderhill CoU (Sep 30 annual renewal pattern observed)
insert into public.association_config (association_code, city, requires_cou, cou_renewal_month, notes)
values
  ('MANXI', 'Lauderhill', true, 9, 'Manors XI — Lauderhill annual CoU renewal due Sep 30')
on conflict (association_code) do update set
  city = excluded.city,
  requires_cou = excluded.requires_cou,
  cou_renewal_month = excluded.cou_renewal_month,
  notes = excluded.notes,
  updated_at = now();

-- ---------------------------------------------------------------------
-- 10. updated_at trigger (one trigger function, applied to all tables)
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'unit_drive_folders','unit_leases','unit_purchases','unit_insurance',
      'unit_violations','unit_certificate_of_use','compliance_alerts','association_config'
    ])
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.tg_set_updated_at();', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 11. RLS — staff/admin read all; board members read their association
-- ---------------------------------------------------------------------
alter table public.unit_drive_folders        enable row level security;
alter table public.unit_leases               enable row level security;
alter table public.unit_purchases            enable row level security;
alter table public.unit_insurance            enable row level security;
alter table public.unit_violations           enable row level security;
alter table public.unit_certificate_of_use   enable row level security;
alter table public.compliance_alerts         enable row level security;
alter table public.drive_indexer_log         enable row level security;
alter table public.association_config        enable row level security;
alter table public.drive_pre_migration_snapshot enable row level security;

-- Staff/service role: full access (server-side queries from API routes)
-- Authenticated users (board): read access only — adjust JWT claim to match your auth setup.
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'unit_drive_folders','unit_leases','unit_purchases','unit_insurance',
      'unit_violations','unit_certificate_of_use','compliance_alerts',
      'drive_indexer_log','association_config','drive_pre_migration_snapshot'
    ])
  loop
    execute format('drop policy if exists service_all on public.%I;', t);
    execute format(
      'create policy service_all on public.%I
       for all to service_role using (true) with check (true);', t);

    execute format('drop policy if exists auth_read on public.%I;', t);
    execute format(
      'create policy auth_read on public.%I
       for select to authenticated using (true);', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. Convenience view: unit compliance dashboard
-- ---------------------------------------------------------------------
create or replace view public.v_unit_compliance as
with latest_lease as (
  select distinct on (account_number)
    account_number, tenant_name, lease_start_date, lease_end_date, application_status
  from public.unit_leases
  where application_status in ('active','approved','renewed')
  order by account_number, lease_end_date desc nulls last
),
latest_insurance as (
  select distinct on (account_number)
    account_number, carrier, policy_number, effective_date, expiration_date
  from public.unit_insurance
  order by account_number, expiration_date desc nulls last
),
latest_cou as (
  select distinct on (account_number)
    account_number, certificate_number, issue_date, expiration_date, status
  from public.unit_certificate_of_use
  order by account_number, expiration_date desc nulls last
),
open_violations as (
  select account_number, count(*) as open_count, min(resolution_due_date) as next_due
  from public.unit_violations
  where status in ('open','in_progress','escalated')
  group by account_number
)
select
  l.account_number,
  l.tenant_name,
  l.lease_end_date,
  case
    when l.lease_end_date is null then null
    when l.lease_end_date < current_date then 'expired'
    when l.lease_end_date <= current_date + interval '30 days' then 'urgent'
    when l.lease_end_date <= current_date + interval '60 days' then 'warning'
    else 'ok'
  end as lease_status,
  i.carrier as insurance_carrier,
  i.expiration_date as insurance_expiration,
  case
    when i.expiration_date is null then null
    when i.expiration_date < current_date then 'expired'
    when i.expiration_date <= current_date + interval '30 days' then 'urgent'
    when i.expiration_date <= current_date + interval '60 days' then 'warning'
    else 'ok'
  end as insurance_status,
  c.expiration_date as cou_expiration,
  case
    when c.expiration_date is null then null
    when c.expiration_date < current_date then 'expired'
    when c.expiration_date <= current_date + interval '30 days' then 'urgent'
    when c.expiration_date <= current_date + interval '60 days' then 'warning'
    else 'ok'
  end as cou_status,
  coalesce(v.open_count, 0) as open_violation_count,
  v.next_due as next_violation_due
from latest_lease l
full outer join latest_insurance i using (account_number)
full outer join latest_cou        c using (account_number)
full outer join open_violations   v using (account_number);

comment on view public.v_unit_compliance is
'Single-row-per-unit compliance summary used by /admin/audit dashboard.';
