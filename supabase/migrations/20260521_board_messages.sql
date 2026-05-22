-- =====================================================================
-- 20260521_board_messages.sql
--
-- A monthly "Message from the Board" — staff request a note from the
-- board president from the report builder; the president writes it via
-- a tokenized link; the generated monthly report includes it as a
-- section. One message per association per month.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.board_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code    text        NOT NULL,
  month               text        NOT NULL,            -- 'YYYY-MM'
  token               text        NOT NULL UNIQUE,     -- unguessable form link
  message             text,                            -- null until the president submits
  author_email        text,                            -- who it was sent to
  author_name         text,
  author_role         text,
  requested_by_email  text,                            -- staff who requested it
  requested_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  UNIQUE (association_code, month)
);

CREATE INDEX IF NOT EXISTS board_messages_token_idx ON public.board_messages (token);

ALTER TABLE public.board_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_board_messages"
  ON public.board_messages FOR ALL TO service_role USING (true);
