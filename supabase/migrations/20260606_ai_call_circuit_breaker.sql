-- =====================================================================
-- 20260606_ai_call_circuit_breaker.sql
--
-- Global Claude (Anthropic) call rate counter — backs lib/anthropic-guard.ts
-- so no runaway anywhere in the app can blow the API bill again (see the
-- 2026-06-06 webhook-loop incident).
--
-- record_ai_call(p_cap) atomically increments the current minute's bucket,
-- then returns whether the rolling 5-minute total is still within p_cap.
-- The guard fails OPEN if this function/table is missing, so applying this
-- migration is what ARMS the breaker — code deploy alone is inert until then.
--
-- Idempotent.
-- =====================================================================

create table if not exists public.ai_call_log (
  minute_bucket timestamptz primary key,
  call_count    int not null default 0
);
create index if not exists ai_call_log_recent_idx on public.ai_call_log (minute_bucket desc);

grant select, insert, update, delete on public.ai_call_log to service_role;

create or replace function public.record_ai_call(p_cap int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare total int;
begin
  insert into public.ai_call_log (minute_bucket, call_count)
    values (date_trunc('minute', now()), 1)
    on conflict (minute_bucket) do update set call_count = public.ai_call_log.call_count + 1;

  select coalesce(sum(call_count), 0) into total
    from public.ai_call_log
    where minute_bucket > now() - interval '5 minutes';

  -- best-effort cleanup so the table stays tiny
  delete from public.ai_call_log where minute_bucket < now() - interval '1 hour';

  return total <= p_cap;
end $$;

grant execute on function public.record_ai_call(int) to service_role;

NOTIFY pgrst, 'reload schema';
