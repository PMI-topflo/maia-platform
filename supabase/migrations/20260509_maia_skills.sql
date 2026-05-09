-- Claude Agent Skills uploaded by staff and injected into MAIA prompts.
-- Instructional only: SKILL.md text + frontmatter metadata; no script execution.

create table if not exists public.maia_skills (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique,
  name         text        not null,
  description  text        not null,
  audience     text        not null check (audience in ('internal', 'customer', 'both')),
  body         text        not null,
  enabled      boolean     not null default true,
  uploaded_by  text,
  storage_path text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists maia_skills_enabled_audience_idx
  on public.maia_skills (enabled, audience);

alter table public.maia_skills enable row level security;

create policy "service_role_maia_skills" on public.maia_skills
  using (auth.role() = 'service_role');

-- Storage bucket for the original SKILL.md uploads (audit trail).
insert into storage.buckets (id, name, public)
  values ('maia-skills', 'maia-skills', false)
  on conflict (id) do nothing;

create policy "service_role_skills_all" on storage.objects
  for all to service_role
  using (bucket_id = 'maia-skills')
  with check (bucket_id = 'maia-skills');
