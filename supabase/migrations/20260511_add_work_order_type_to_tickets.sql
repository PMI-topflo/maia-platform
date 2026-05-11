-- Allow staff to pick the CINC work-order type when creating a work-order
-- ticket. Stores both the CINC type ID (the source of truth used by the
-- API call) and the human-readable name (for display without an extra
-- CINC API call). Both nullable: a ticket of type='ticket' (not work_order)
-- has no work-order type; an incoming work_order whose creator didn't pick
-- a type falls back to the default in lib/integrations/cinc.ts.

alter table public.tickets
  add column if not exists work_order_type_id   integer,
  add column if not exists work_order_type_name text;
