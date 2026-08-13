-- =====================================================================
-- 20260813_application_communications.sql
--
-- Free-form correspondence filed against a leasing application: the emails
-- that go back and forth with the board, the tenants and the agents outside
-- MAIA's own request/approval flows. Staff file one by forwarding it to
-- maia@pmitop.com with "@maia update application MANXI103" — the body, the
-- sender, and the email's own date are stored here and shown in the
-- application's Communication history alongside document requests and the
-- approval letter.
--
-- `gmail_message_id` is uniquely indexed (where present) so re-processing the
-- same Gmail message — which happens routinely on webhook retries — updates
-- nothing instead of filing the email twice.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_communications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL,
  association_code  text,
  unit_label        text,
  -- 'inbound' = someone wrote to us, 'outbound' = we wrote to them,
  -- 'note' = staff filed a record of something that happened off-email.
  direction         text NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound','outbound','note')),
  subject           text,
  body              text NOT NULL,
  from_email        text,
  from_name         text,
  to_emails         text[],
  cc_emails         text[],
  attachment_names  text[],
  -- The date on the EMAIL, not the date we filed it. A board thread forwarded
  -- a week later must appear in the timeline where it actually happened.
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  gmail_message_id  text,
  gmail_thread_id   text,
  logged_by         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS application_communications_app_idx
  ON public.application_communications (application_id, occurred_at DESC);

-- Idempotency: one row per Gmail message. Partial so hand-filed notes
-- (no Gmail id) are never constrained against each other.
CREATE UNIQUE INDEX IF NOT EXISTS application_communications_gmail_msg_uidx
  ON public.application_communications (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- ── Data-API exposure (REQUIRED — Supabase drops auto-grants 2026-10-30) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_communications
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.application_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_application_communications" ON public.application_communications;
CREATE POLICY "service_role_all_application_communications"
  ON public.application_communications FOR ALL TO service_role USING (true);
