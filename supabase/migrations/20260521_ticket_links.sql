-- =====================================================================
-- 20260521_ticket_links.sql
--
-- Relates one ticket / work order to another (a ticket can be linked to
-- another ticket, or to a work order — work orders are tickets with
-- type='work_order'). The link is undirected: the route always stores
-- the pair with the smaller id first, so A-B and B-A are the same row
-- and the UNIQUE constraint dedupes them.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ticket_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          bigint NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  related_ticket_id  bigint NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_by_email   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_links_distinct CHECK (ticket_id <> related_ticket_id),
  UNIQUE (ticket_id, related_ticket_id)
);

CREATE INDEX IF NOT EXISTS ticket_links_ticket_idx  ON public.ticket_links (ticket_id);
CREATE INDEX IF NOT EXISTS ticket_links_related_idx ON public.ticket_links (related_ticket_id);

ALTER TABLE public.ticket_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_ticket_links"
  ON public.ticket_links FOR ALL TO service_role USING (true);
