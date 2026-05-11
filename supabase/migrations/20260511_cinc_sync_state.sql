-- Cursor + status for the inbound CINC sync cron (B-1 / B-2).
--
-- Single-row table (id=1 pattern, matching maia_watch_state). Holds the
-- last createdFromDate cursor used against CINC's GET /workOrders
-- endpoint, plus last_run_at / last_error for observability.

create table if not exists public.cinc_sync_state (
  id           integer     primary key default 1,
  cursor       timestamptz,
  last_run_at  timestamptz,
  last_error   text,
  updated_at   timestamptz not null default now(),
  constraint cinc_sync_state_single_row check (id = 1)
);

insert into public.cinc_sync_state (id, cursor)
  values (1, now() - interval '30 days')
  on conflict (id) do nothing;

alter table public.cinc_sync_state enable row level security;

create policy "service_role_cinc_sync_state" on public.cinc_sync_state
  using (auth.role() = 'service_role');
