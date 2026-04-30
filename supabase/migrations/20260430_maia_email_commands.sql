-- MAIA email command processing log
CREATE TABLE IF NOT EXISTS maia_email_commands (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id  TEXT        NOT NULL,
  gmail_thread_id   TEXT        NOT NULL,
  sender_email      TEXT        NOT NULL,
  sender_name       TEXT,
  subject           TEXT,
  body_text         TEXT,
  trigger_phrase    TEXT,
  record_type       TEXT,
  extracted_data    JSONB,
  status            TEXT        NOT NULL DEFAULT 'pending',
  error_message     TEXT,
  db_record_id      TEXT,
  db_table          TEXT,
  reply_sent        BOOLEAN     DEFAULT false,
  attachments       JSONB       DEFAULT '[]',
  reference_code    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_maia_gmail_message_id UNIQUE (gmail_message_id)
);

CREATE INDEX idx_maia_email_commands_created ON maia_email_commands (created_at DESC);
CREATE INDEX idx_maia_email_commands_status  ON maia_email_commands (status);

-- Gmail watch state (single-row singleton, id always = 1)
CREATE TABLE IF NOT EXISTS maia_watch_state (
  id              INTEGER     PRIMARY KEY DEFAULT 1,
  last_history_id TEXT,
  watch_expiry    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE maia_email_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE maia_watch_state    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_maia_email_commands"
  ON maia_email_commands FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_maia_watch_state"
  ON maia_watch_state FOR ALL TO service_role USING (true);
