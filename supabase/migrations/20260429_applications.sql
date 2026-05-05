-- Resident application submissions (created before security hardening migration)
create table if not exists public.applications (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  association             text not null,
  app_type                text not null,  -- 'individual' | 'couple' | 'additionalResident' | 'commercial'
  couple_has_cert         boolean,
  applicants              jsonb,          -- array of applicant objects (non-commercial)
  principals              jsonb,          -- array of {name, dob} (commercial only)
  entity_name             text,
  sunbiz_id               text,
  total_charged           integer not null,  -- in dollars
  stripe_session_id       text,
  stripe_payment_status   text not null default 'pending',
  stripe_amount_paid      integer,
  applycheck_status       text not null default 'pending',  -- 'pending' | 'invited' | 'partial' | 'error'
  applycheck_report_url   text,
  board_approval_status   text not null default 'pending',  -- 'pending' | 'approved' | 'denied'
  board_notes             text,
  language                text not null default 'en',
  docs_gov_id_url         text,
  docs_proof_income_url   text,
  docs_marriage_cert_url  text
);

alter table public.applications enable row level security;

-- Anon INSERT: form creates pending rows before Stripe checkout
create policy "allow_insert" on public.applications
  for insert to anon, authenticated
  with check (stripe_payment_status = 'pending');

-- Service role: full access for webhooks and admin dashboard
create policy "service_role_applications" on public.applications
  for all to service_role using (true) with check (true);

-- Storage bucket for application documents
insert into storage.buckets (id, name, public)
  values ('application-docs', 'application-docs', false)
  on conflict (id) do nothing;

-- Anon can upload (pre-payment); only service_role can read
create policy "anon_upload_docs" on storage.objects
  for insert to anon
  with check (bucket_id = 'application-docs');

create policy "service_role_read_docs" on storage.objects
  for select to service_role
  using (bucket_id = 'application-docs');
