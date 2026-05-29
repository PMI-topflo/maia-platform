-- =====================================================================
-- 20260529_association_insurance_policies.sql
--
-- I3 — Association-level insurance compliance (FULL Florida HOA/condo
-- checklist). Distinct from public.unit_insurance, which tracks the
-- per-UNIT HO-6 policies individual owners carry. THIS table tracks the
-- MASTER policies the ASSOCIATION itself holds — the ones that create
-- board liability exposure when they lapse (D&O, fidelity, etc.).
--
-- One row per (association, policy_type) version. A renewal supersedes
-- the prior policy the same way association_documents versions docs:
-- the new active row is inserted, the old one gets archived_at set.
-- A "waived" row (waived=true) records an intentional decision NOT to
-- carry a given coverage (e.g. no flood policy because no building sits
-- in a FEMA flood zone) so the checklist UI can distinguish "missing"
-- from "deliberately not carried".
--
-- The canonical policy_type keys + their requirement tier live in
-- lib/association-insurance.ts — this column is free text (not an enum)
-- so the checklist can grow without a migration, matching the
-- association_documents.category convention.
--
-- COI PDFs are stored in the existing `association-documents` storage
-- bucket under <CODE>/insurance/<policy_type>/... (see the insurance
-- upload-url route). We keep only the storage path + file metadata on
-- the row; the file itself lives in storage.
--
-- All statements idempotent / re-runnable.
-- =====================================================================

-- ── Table ────────────────────────────────────────────────────────────
create table if not exists public.association_insurance_policies (
  id                   bigint generated always as identity primary key,
  association_code     text        not null,
  -- One of the keys in lib/association-insurance.ts POLICY_TYPES
  -- (master_property, general_liability, directors_officers,
  --  fidelity_crime, flood, windstorm, workers_comp, umbrella,
  --  equipment_breakdown, ordinance_law, cyber). Free text so the
  -- checklist can expand without a migration.
  policy_type          text        not null,
  carrier              text,
  policy_number        text,
  named_insured        text,
  effective_date       date,
  expiration_date      date,
  coverage_amount_usd  numeric(14,2),
  premium_usd          numeric(12,2),
  -- Producing agent / broker contact for renewal follow-up.
  agent_name           text,
  agent_email          text,
  agent_phone          text,
  -- Certificate of Insurance PDF in the association-documents bucket.
  coi_storage_path     text,
  coi_filename         text,
  coi_mime_type        text,
  coi_file_size_bytes  bigint,
  -- Intentional non-coverage decision. When true the checklist treats
  -- this policy_type as satisfied-by-waiver rather than missing.
  waived               boolean     not null default false,
  waived_reason        text,
  notes                text,
  -- Version supersede — same pattern as association_documents. NULL =
  -- this is the current/active policy for its (assoc, type).
  archived_at          timestamptz,
  archived_by_email    text,
  created_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_assoc_ins_code on public.association_insurance_policies(association_code);
create index if not exists idx_assoc_ins_type on public.association_insurance_policies(policy_type);
create index if not exists idx_assoc_ins_exp  on public.association_insurance_policies(expiration_date);
create index if not exists idx_assoc_ins_active on public.association_insurance_policies(archived_at) where archived_at is null;

-- At most ONE active (non-archived) row per (association, policy_type).
-- The API archives the prior active row BEFORE inserting a renewal, so
-- this unique guarantee holds. A waived row counts as the active row.
create unique index if not exists uq_assoc_ins_active
  on public.association_insurance_policies(association_code, policy_type)
  where archived_at is null;

-- ── updated_at trigger (reuse the shared function from the
--    unit_compliance migration) ──────────────────────────────────────
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.association_insurance_policies;
create trigger set_updated_at before update on public.association_insurance_policies
  for each row execute function public.tg_set_updated_at();

-- ── Data-API exposure (REQUIRED for new tables — see migration-status.ts) ─
-- Broad grants match the legacy default; RLS below is the real gate.
grant select, insert, update, delete on public.association_insurance_policies
  to anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
alter table public.association_insurance_policies enable row level security;

drop policy if exists service_all on public.association_insurance_policies;
create policy service_all on public.association_insurance_policies
  for all to service_role using (true) with check (true);

-- Board members / staff read via authenticated; mirrors the broad
-- auth_read policy the other compliance tables use. Writes go through
-- service_role API routes only.
drop policy if exists auth_read on public.association_insurance_policies;
create policy auth_read on public.association_insurance_policies
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Extend the compliance_alerts.alert_type CHECK to allow the two new
-- association-insurance alert types the daily cron emits. The original
-- constraint was created inline (auto-named compliance_alerts_alert_type_check)
-- but we drop ANY check constraint referencing alert_type to be safe,
-- then re-add the full allowed set. Idempotent: re-running drops and
-- re-adds the same constraint.
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
      'assoc_insurance_expiring','assoc_insurance_expired'
    ));
end $$;
