-- =====================================================================
-- Tickets schema (greenfield)
--
-- Replaces the legacy board_tickets table with a single ticket primitive
-- that backs both customer-facing tickets and vendor work orders. Every
-- inbound channel (email, SMS, WhatsApp, web, phone) becomes a message
-- attached to a ticket via the ticket_messages table.
--
-- Integration outbox carries outbound syncs to Rentvine (and CINC once
-- credentials arrive); a cron drains it with retry+backoff.
-- =====================================================================

-- Drop legacy table — safe per user direction (system in test, no live data)
DROP TABLE IF EXISTS board_tickets CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Sequence + ticket numbering helper (TKT-YYYY-NNNN, monotonic global)
-- ─────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq;

CREATE OR REPLACE FUNCTION next_ticket_number() RETURNS TEXT
  LANGUAGE plpgsql AS $$
DECLARE
  n BIGINT;
BEGIN
  n := nextval('ticket_number_seq');
  RETURN 'TKT-' || EXTRACT(YEAR FROM NOW())::INT || '-' || LPAD(n::TEXT, 4, '0');
END;
$$;

-- Generic updated_at trigger function (idempotent name)
CREATE OR REPLACE FUNCTION tickets_set_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- tickets — one row per ticket or work order
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id                      BIGSERIAL    PRIMARY KEY,
  ticket_number           TEXT         UNIQUE NOT NULL DEFAULT next_ticket_number(),
  type                    TEXT         NOT NULL DEFAULT 'ticket',
  status                  TEXT         NOT NULL DEFAULT 'open',
  priority                TEXT         NOT NULL DEFAULT 'normal',
  channel_origin          TEXT         NOT NULL,
  association_code        TEXT,
  persona                 TEXT,
  contact_name            TEXT,
  contact_email           TEXT,
  contact_phone           TEXT,
  subject                 TEXT,
  summary                 TEXT,
  assignee_email          TEXT,
  due_at                  TIMESTAMPTZ,
  resolved_at             TIMESTAMPTZ,
  gmail_thread_id         TEXT,
  rentvine_workorder_id   TEXT,
  cinc_workorder_id       TEXT,
  sync_status             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_tickets_type     CHECK (type     IN ('ticket', 'work_order')),
  CONSTRAINT chk_tickets_status   CHECK (status   IN ('open', 'pending', 'waiting_external', 'resolved', 'closed')),
  CONSTRAINT chk_tickets_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT chk_tickets_channel  CHECK (channel_origin IN ('email', 'whatsapp', 'sms', 'web', 'phone', 'internal'))
);

CREATE INDEX idx_tickets_status              ON tickets (status);
CREATE INDEX idx_tickets_assignee            ON tickets (assignee_email);
CREATE INDEX idx_tickets_association         ON tickets (association_code);
CREATE INDEX idx_tickets_gmail_thread        ON tickets (gmail_thread_id);
CREATE INDEX idx_tickets_contact_email_open  ON tickets (contact_email, status);
CREATE INDEX idx_tickets_contact_phone_open  ON tickets (contact_phone, status);
CREATE INDEX idx_tickets_type                ON tickets (type);
CREATE INDEX idx_tickets_created_desc        ON tickets (created_at DESC);

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- ticket_messages — every interaction (email, SMS, WhatsApp, web, phone, note)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_messages (
  id                BIGSERIAL    PRIMARY KEY,
  ticket_id         BIGINT       NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  direction         TEXT         NOT NULL,
  channel           TEXT         NOT NULL,
  from_addr         TEXT,
  to_addr           TEXT,
  subject           TEXT,
  body              TEXT,
  body_html         TEXT,
  attachments       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  external_id       TEXT,
  rentvine_note_id  TEXT,
  cinc_note_id      TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ticket_messages_direction CHECK (direction IN ('inbound', 'outbound', 'internal_note')),
  CONSTRAINT chk_ticket_messages_channel   CHECK (channel   IN ('email', 'whatsapp', 'sms', 'web', 'phone', 'internal'))
);

-- Dedupe inbound messages by external id within a channel (gmail msg id, twilio sid, etc.)
CREATE UNIQUE INDEX uq_ticket_messages_channel_external
  ON ticket_messages (channel, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_ticket_messages_ticket
  ON ticket_messages (ticket_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- ticket_events — audit log
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_events (
  id            BIGSERIAL    PRIMARY KEY,
  ticket_id     BIGINT       NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_email   TEXT,
  event_type    TEXT         NOT NULL,
  payload       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_events_ticket
  ON ticket_events (ticket_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- work_order_details — 1:1 extension when tickets.type='work_order'
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_order_details (
  ticket_id       BIGINT       PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  vendor_email    TEXT,
  vendor_name     TEXT,
  unit_id         TEXT,
  scheduled_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  cost_cents      INTEGER,
  invoice_url     TEXT,
  before_photos   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  after_photos    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_work_order_details_updated_at
  BEFORE UPDATE ON work_order_details
  FOR EACH ROW EXECUTE FUNCTION tickets_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- integration_outbox — outbound syncs to Rentvine/CINC, drained by cron
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_outbox (
  id             BIGSERIAL    PRIMARY KEY,
  target         TEXT         NOT NULL,
  entity_type    TEXT         NOT NULL,
  entity_id      BIGINT       NOT NULL,
  operation      TEXT         NOT NULL,
  payload        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  attempts       INTEGER      NOT NULL DEFAULT 0,
  next_retry_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_error     TEXT,
  status         TEXT         NOT NULL DEFAULT 'pending',
  succeeded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_outbox_target      CHECK (target      IN ('rentvine', 'cinc')),
  CONSTRAINT chk_outbox_entity_type CHECK (entity_type IN ('ticket', 'ticket_message')),
  CONSTRAINT chk_outbox_status      CHECK (status      IN ('pending', 'succeeded', 'failed'))
);

CREATE INDEX idx_outbox_pending
  ON integration_outbox (next_retry_at)
  WHERE status = 'pending';

CREATE INDEX idx_outbox_entity
  ON integration_outbox (entity_type, entity_id);

-- ─────────────────────────────────────────────────────────────────────
-- RLS — service-role only (consistent with maia_email_commands pattern;
-- staff dashboards read via supabase-admin which bypasses RLS)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE tickets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_details  ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_outbox  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_tickets"
  ON tickets FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_ticket_messages"
  ON ticket_messages FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_ticket_events"
  ON ticket_events FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_work_order_details"
  ON work_order_details FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_integration_outbox"
  ON integration_outbox FOR ALL TO service_role USING (true);
