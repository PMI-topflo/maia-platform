-- User direction, 2026-08-24: "merge Resolved and Closed as Resolved" —
-- the two statuses were functionally identical everywhere in the codebase
-- (both stamped resolved_at, both excluded from overdue/open, and CINC
-- itself doesn't distinguish them — see lib/integrations/cinc.ts). Kept
-- as two labels only added confusion. Backfill existing 'closed' rows,
-- then drop 'closed' from the allowed values so it can't come back.

update public.tickets
   set status = 'resolved', updated_at = now()
 where status = 'closed';

alter table public.tickets
  drop constraint if exists chk_tickets_status;

alter table public.tickets
  add constraint chk_tickets_status
  check (status in ('open', 'pending', 'waiting_external', 'resolved', 'canceled'));
