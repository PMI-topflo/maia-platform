-- Add a 'canceled' terminal status for tickets/work orders that were
-- called off before completion (owner/board didn't approve, association
-- canceled the request, vendor never proceeded, etc.). Previously staff
-- had to overload 'closed' for this, losing the distinction in reports
-- and staff performance stats (both key off resolved_at / the
-- resolved|closed pair, so a dedicated status + timestamp keeps
-- cancellations out of "resolved work" metrics without extra code).

alter table public.tickets
  add column if not exists canceled_at timestamptz;

alter table public.tickets
  drop constraint if exists chk_tickets_status;

alter table public.tickets
  add constraint chk_tickets_status
  check (status in ('open', 'pending', 'waiting_external', 'resolved', 'closed', 'canceled'));
