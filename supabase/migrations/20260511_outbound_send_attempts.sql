-- Tracks every sendEmail() invocation for application-level rate limiting.
-- Distinct from email_logs (which is enriched by callers post-send) so the
-- counter is reliable even when a caller forgets to logEmail() or the send
-- never reaches the provider.

create table if not exists public.outbound_send_attempts (
  id              bigserial   primary key,
  to_email        text        not null,
  subject         text        not null,
  blocked_reason  text,
  created_at      timestamptz not null default now()
);

-- Counters query: where created_at > now() - window, optionally filtered by to_email.
create index if not exists outbound_send_attempts_created_at_idx
  on public.outbound_send_attempts (created_at desc);

create index if not exists outbound_send_attempts_to_email_created_at_idx
  on public.outbound_send_attempts (to_email, created_at desc);

alter table public.outbound_send_attempts enable row level security;

create policy "service_role_outbound_send_attempts" on public.outbound_send_attempts
  using (auth.role() = 'service_role');
