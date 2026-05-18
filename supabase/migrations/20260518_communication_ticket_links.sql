-- =====================================================================
-- communication_ticket_links — many-to-many join between
-- general_conversations / email_logs and tickets.
--
-- Communications (web chat, SMS, WhatsApp, outbound emails) live in
-- their own tables and weren't reachable from a ticket's view (and
-- vice versa). Staff need to attach a conversation or email thread
-- to a specific ticket / WO when they realize it relates to ongoing
-- work — e.g. "this owner's email is about TKT-2026-0042".
--
-- communication_type discriminates the source table:
--   - 'conversation' → general_conversations.id (uuid)
--   - 'email'        → email_logs.id            (uuid)
-- communication_id is stored as TEXT so both UUID and bigint
-- sources can share one column.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.communication_ticket_links (
  id                  bigserial   PRIMARY KEY,
  communication_type  text        NOT NULL CHECK (communication_type IN ('conversation', 'email')),
  communication_id    text        NOT NULL,
  ticket_id           bigint      NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  linked_by_email     text,
  linked_at           timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (communication_type, communication_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS ctl_by_communication_idx
  ON public.communication_ticket_links (communication_type, communication_id);

CREATE INDEX IF NOT EXISTS ctl_by_ticket_idx
  ON public.communication_ticket_links (ticket_id);

ALTER TABLE public.communication_ticket_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_communication_ticket_links"
  ON public.communication_ticket_links FOR ALL TO service_role USING (true);
