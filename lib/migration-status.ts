// =====================================================================
// lib/migration-status.ts
//
// Snapshot of which recent migrations are applied to the live DB.
//
// Each entry lists a key artifact (column or table) we can probe via
// information_schema, plus the SQL to paste into Supabase if it's
// missing. Surfaced in /admin/tools so we always know when schema
// has drifted from code without grepping through logs.
//
// To add a new migration: append to MIGRATIONS, include the
// artifact's column/table name and the ALTER/CREATE SQL inline.
//
// ⚠ NEW TABLES — Supabase Data-API exposure (effective 2026-10-30)
// ─────────────────────────────────────────────────────────────────
// As of 2026-10-30, Supabase no longer auto-grants SELECT/INSERT/
// UPDATE/DELETE on new public.* tables to anon / authenticated /
// service_role. A new table created without an explicit GRANT block
// is INVISIBLE to supabase-js (and PostgREST and GraphQL) even with
// RLS policies in place. Add the GRANT block whenever the migration
// CREATEs a new table. See supabase/migrations/_TEMPLATE_new_table.sql
// for the canonical pattern. Existing tables are unaffected.
// Source: https://github.com/orgs/supabase/discussions/45329
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export type MigrationArtifact =
  | { type: 'column'; table: string; column: string }
  | { type: 'table';  table: string }

export interface MigrationEntry {
  key:         string
  label:       string
  description: string
  filename:    string
  artifact:    MigrationArtifact
  sql:         string  // exact SQL to paste if missing
}

export interface MigrationCheckResult extends MigrationEntry {
  applied: boolean
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    key:         'pmi_staff_can_see_all',
    label:       'Comms visibility flag',
    description: 'pmi_staff.can_see_all_communications',
    filename:    '20260518_pmi_staff_can_see_all_communications.sql',
    artifact:    { type: 'column', table: 'pmi_staff', column: 'can_see_all_communications' },
    sql: `ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS can_see_all_communications boolean NOT NULL DEFAULT false;`,
  },
  {
    key:         'tickets_archived_at',
    label:       'Soft-archive tickets',
    description: 'tickets.archived_at',
    filename:    '20260518_tickets_archived_at.sql',
    artifact:    { type: 'column', table: 'tickets', column: 'archived_at' },
    sql: `ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS tickets_active_idx
  ON public.tickets (updated_at DESC)
  WHERE archived_at IS NULL;`,
  },
  {
    key:         'ticket_events_happened_at',
    label:       'Two-timestamp audit events',
    description: 'ticket_events.happened_at',
    filename:    '20260518_ticket_events_happened_at.sql',
    artifact:    { type: 'column', table: 'ticket_events', column: 'happened_at' },
    sql: `ALTER TABLE public.ticket_events
  ADD COLUMN IF NOT EXISTS happened_at timestamptz;

UPDATE public.ticket_events SET happened_at = created_at WHERE happened_at IS NULL;

ALTER TABLE public.ticket_events
  ALTER COLUMN happened_at SET DEFAULT NOW(),
  ALTER COLUMN happened_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS ticket_events_happened_at_idx
  ON public.ticket_events (ticket_id, happened_at DESC);`,
  },
  {
    key:         'work_order_attachments',
    label:       'CINC vendor photos mirror',
    description: 'work_order_attachments table',
    filename:    '20260518_work_order_attachments.sql',
    artifact:    { type: 'table', table: 'work_order_attachments' },
    sql: `CREATE TABLE IF NOT EXISTS public.work_order_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           bigint      NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  cinc_workorder_id   integer,
  source              text        NOT NULL CHECK (source IN ('cinc', 'email', 'staff_upload')),
  storage_path        text        NOT NULL,
  filename            text        NOT NULL,
  mime_type           text        NOT NULL,
  file_size_bytes     bigint      NOT NULL,
  cinc_filename       text,
  cinc_created_date   timestamptz,
  uploaded_by_email   text,
  mirrored_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woa_ticket_idx
  ON public.work_order_attachments (ticket_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS woa_cinc_dedupe_idx
  ON public.work_order_attachments (ticket_id, cinc_filename, cinc_created_date)
  WHERE source = 'cinc';
ALTER TABLE public.work_order_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_work_order_attachments"
  ON public.work_order_attachments FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'wo_details_cinc_fields',
    label:       'CINC unit metadata on WOs',
    description: 'work_order_details.cinc_ho_id',
    filename:    '20260518_work_order_details_cinc_fields.sql',
    artifact:    { type: 'column', table: 'work_order_details', column: 'cinc_ho_id' },
    sql: `ALTER TABLE public.work_order_details
  ADD COLUMN IF NOT EXISTS cinc_ho_id          text,
  ADD COLUMN IF NOT EXISTS cinc_property_id    integer,
  ADD COLUMN IF NOT EXISTS work_location_name  text,
  ADD COLUMN IF NOT EXISTS address_line1       text,
  ADD COLUMN IF NOT EXISTS address_line2       text,
  ADD COLUMN IF NOT EXISTS city                text,
  ADD COLUMN IF NOT EXISTS state               text,
  ADD COLUMN IF NOT EXISTS zip                 text;`,
  },
  {
    key:         'wo_details_cinc_vendor_id',
    label:       'CINC vendor reassign support',
    description: 'work_order_details.cinc_vendor_id',
    filename:    '20260518_work_order_details_cinc_vendor_id.sql',
    artifact:    { type: 'column', table: 'work_order_details', column: 'cinc_vendor_id' },
    sql: `ALTER TABLE public.work_order_details
  ADD COLUMN IF NOT EXISTS cinc_vendor_id integer;`,
  },
  {
    key:         'communication_ticket_links',
    label:       'Email/conversation ↔ ticket linking',
    description: 'communication_ticket_links table',
    filename:    '20260518_communication_ticket_links.sql',
    artifact:    { type: 'table', table: 'communication_ticket_links' },
    sql: `CREATE TABLE IF NOT EXISTS public.communication_ticket_links (
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
  ON public.communication_ticket_links FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'email_thread_autolink',
    label:       'Email thread auto-link',
    description: 'email_logs.gmail_thread_id',
    filename:    '20260518_email_thread_autolink.sql',
    artifact:    { type: 'column', table: 'email_logs', column: 'gmail_thread_id' },
    sql: `ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS gmail_thread_id text;
CREATE INDEX IF NOT EXISTS email_logs_thread_idx
  ON public.email_logs (gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;
ALTER TABLE public.communication_ticket_links
  ADD COLUMN IF NOT EXISTS gmail_thread_id text;
CREATE INDEX IF NOT EXISTS ctl_thread_idx
  ON public.communication_ticket_links (gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;`,
  },
  {
    key:         'email_logs_dismissed',
    label:       'Email soft-dismiss',
    description: 'email_logs.dismissed_at',
    filename:    '20260518_email_logs_dismissed_at.sql',
    artifact:    { type: 'column', table: 'email_logs', column: 'dismissed_at' },
    sql: `ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS dismissed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_by_email text;
CREATE INDEX IF NOT EXISTS email_logs_active_idx
  ON public.email_logs (created_at DESC)
  WHERE dismissed_at IS NULL;`,
  },
  {
    key:         'email_logs_auto_dismiss',
    label:       'Auto-dismiss noise + internal',
    description: 'email_noise_senders table + email_logs.auto_dismiss_reason',
    filename:    '20260518_email_logs_auto_dismiss.sql',
    artifact:    { type: 'table', table: 'email_noise_senders' },
    sql: `CREATE TABLE IF NOT EXISTS public.email_noise_senders (
  id              bigserial   PRIMARY KEY,
  pattern         text        NOT NULL UNIQUE,
  reason          text,
  added_by_email  text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE public.email_noise_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_email_noise_senders"
  ON public.email_noise_senders FOR ALL TO service_role USING (true);
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS auto_dismiss_reason text
    CHECK (auto_dismiss_reason IS NULL OR auto_dismiss_reason IN ('noise_sender', 'internal'));`,
  },
  {
    key:         'staff_gmail_watch_diag',
    label:       'Gmail watch diagnostics',
    description: 'staff_gmail_accounts.last_watch_error',
    filename:    '20260518_staff_gmail_watch_diagnostics.sql',
    artifact:    { type: 'column', table: 'staff_gmail_accounts', column: 'last_watch_error' },
    sql: `ALTER TABLE public.staff_gmail_accounts
  ADD COLUMN IF NOT EXISTS last_watch_renewed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_watch_error       text,
  ADD COLUMN IF NOT EXISTS last_watch_error_at    timestamptz;`,
  },
  {
    key:         'sms_consents',
    label:       'A2P 10DLC consent ledger',
    description: 'sms_consents table',
    filename:    '20260519_sms_consents.sql',
    artifact:    { type: 'table', table: 'sms_consents' },
    sql: `CREATE TABLE IF NOT EXISTS public.sms_consents (
  id            bigserial    PRIMARY KEY,
  phone         text         NOT NULL,
  opt_in_text   text         NOT NULL,
  source_url    text         NOT NULL,
  ip_address    text,
  user_agent    text,
  language      text,
  persona       text,
  consented_at  timestamptz  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_consents_phone
  ON public.sms_consents (phone, consented_at DESC);
ALTER TABLE public.sms_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_sms_consents" ON public.sms_consents;
CREATE POLICY "service_role_all_sms_consents"
  ON public.sms_consents FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'dialpad_ingest',
    label:       'Dialpad ingest (SMS + calls)',
    description: 'dialpad_webhook_config table + general_conversations.external_id',
    filename:    '20260519_dialpad_ingest.sql',
    artifact:    { type: 'table', table: 'dialpad_webhook_config' },
    sql: `CREATE TABLE IF NOT EXISTS public.staff_dialpad_lines (
  id                   bigserial    PRIMARY KEY,
  staff_id             uuid         REFERENCES public.pmi_staff(id) ON DELETE CASCADE,
  dialpad_user_id      text         NOT NULL UNIQUE,
  dialpad_email        text,
  dialpad_phone        text,
  dialpad_display_name text,
  active               boolean      NOT NULL DEFAULT true,
  created_at           timestamptz  NOT NULL DEFAULT NOW(),
  updated_at           timestamptz  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sdl_staff ON public.staff_dialpad_lines (staff_id);
CREATE INDEX IF NOT EXISTS idx_sdl_phone ON public.staff_dialpad_lines (dialpad_phone);

CREATE TABLE IF NOT EXISTS public.dialpad_numbers (
  id           bigserial    PRIMARY KEY,
  phone_number text         NOT NULL UNIQUE,
  status       text,
  target_type  text,
  target_id    text,
  label        text,
  created_at   timestamptz  NOT NULL DEFAULT NOW(),
  updated_at   timestamptz  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dialpad_webhook_config (
  id                   smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  webhook_id           text,
  webhook_url          text,
  webhook_secret       text,
  sms_subscription_id  text,
  call_subscription_id text,
  created_at           timestamptz  NOT NULL DEFAULT NOW(),
  updated_at           timestamptz  NOT NULL DEFAULT NOW()
);
INSERT INTO public.dialpad_webhook_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.general_conversations ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gc_external_id ON public.general_conversations (external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.staff_dialpad_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialpad_numbers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialpad_webhook_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_sdl" ON public.staff_dialpad_lines;
DROP POLICY IF EXISTS "service_role_all_dn"  ON public.dialpad_numbers;
DROP POLICY IF EXISTS "service_role_all_dwc" ON public.dialpad_webhook_config;
CREATE POLICY "service_role_all_sdl" ON public.staff_dialpad_lines    FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_dn"  ON public.dialpad_numbers        FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_dwc" ON public.dialpad_webhook_config FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'conversations_archive',
    label:       'Conversation soft-archive',
    description: 'general_conversations.archived_at',
    filename:    '20260520_conversations_archive.sql',
    artifact:    { type: 'column', table: 'general_conversations', column: 'archived_at' },
    sql: `ALTER TABLE public.general_conversations
  ADD COLUMN IF NOT EXISTS archived_at       timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_email text;
CREATE INDEX IF NOT EXISTS general_conversations_active_idx
  ON public.general_conversations (updated_at DESC)
  WHERE archived_at IS NULL;`,
  },
  {
    key:         'email_logs_gmail_message_id',
    label:       'Gmail deletion sync',
    description: 'email_logs.gmail_message_id',
    filename:    '20260520_email_logs_gmail_message_id.sql',
    artifact:    { type: 'column', table: 'email_logs', column: 'gmail_message_id' },
    sql: `ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS gmail_message_id text;

CREATE INDEX IF NOT EXISTS email_logs_gmail_message_id_idx
  ON public.email_logs (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;`,
  },
  {
    key:         'email_logs_email_date',
    label:       'True email date (sort like Gmail)',
    description: 'email_logs.email_date',
    filename:    '20260521_email_logs_email_date.sql',
    artifact:    { type: 'column', table: 'email_logs', column: 'email_date' },
    sql: `ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS email_date timestamptz;

ALTER TABLE public.email_logs
  ALTER COLUMN email_date SET DEFAULT NOW();`,
  },
  {
    key:         'tickets_report_exclusion',
    label:       'Monthly report exclusion flag',
    description: 'tickets.excluded_from_monthly_report',
    filename:    '20260521_tickets_report_exclusion.sql',
    artifact:    { type: 'column', table: 'tickets', column: 'excluded_from_monthly_report' },
    sql: `ALTER TABLE public.tickets
  DROP COLUMN IF EXISTS marked_for_monthly_report;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS excluded_from_monthly_report boolean NOT NULL DEFAULT false;`,
  },
  {
    key:         'monthly_reports',
    label:       'Saved monthly reports',
    description: 'monthly_reports table',
    filename:    '20260521_monthly_reports.sql',
    artifact:    { type: 'table', table: 'monthly_reports' },
    sql: `CREATE TABLE IF NOT EXISTS public.monthly_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code    text        NOT NULL DEFAULT 'ALL',
  month               text        NOT NULL,
  report_markdown     text        NOT NULL,
  generated_by_email  text,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (association_code, month)
);

CREATE INDEX IF NOT EXISTS monthly_reports_assoc_idx
  ON public.monthly_reports (association_code, month DESC);

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_monthly_reports"
  ON public.monthly_reports FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'ticket_links',
    label:       'Ticket-to-ticket links',
    description: 'ticket_links table',
    filename:    '20260521_ticket_links.sql',
    artifact:    { type: 'table', table: 'ticket_links' },
    sql: `CREATE TABLE IF NOT EXISTS public.ticket_links (
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
  ON public.ticket_links FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'board_messages',
    label:       'Board message for the monthly report',
    description: 'board_messages table',
    filename:    '20260521_board_messages.sql',
    artifact:    { type: 'table', table: 'board_messages' },
    sql: `CREATE TABLE IF NOT EXISTS public.board_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code    text        NOT NULL,
  month               text        NOT NULL,
  token               text        NOT NULL UNIQUE,
  message             text,
  author_email        text,
  author_name         text,
  author_role         text,
  requested_by_email  text,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  UNIQUE (association_code, month)
);

CREATE INDEX IF NOT EXISTS board_messages_token_idx ON public.board_messages (token);

ALTER TABLE public.board_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_board_messages"
  ON public.board_messages FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'report_financials',
    label:       'Monthly report financials',
    description: 'report_financials table',
    filename:    '20260522_report_financials.sql',
    artifact:    { type: 'table', table: 'report_financials' },
    sql: `CREATE TABLE IF NOT EXISTS public.report_financials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text        NOT NULL DEFAULT 'ALL',
  month              text        NOT NULL,
  storage_path       text        NOT NULL,
  pdf_filename       text        NOT NULL,
  pdf_size_bytes     bigint      NOT NULL,
  figures            jsonb,
  extract_status     text        NOT NULL DEFAULT 'pending'
                       CHECK (extract_status IN ('pending', 'extracted', 'failed')),
  extract_error      text,
  uploaded_by_email  text,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  extracted_at       timestamptz,
  UNIQUE (association_code, month)
);
CREATE INDEX IF NOT EXISTS report_financials_assoc_idx
  ON public.report_financials (association_code, month DESC);
ALTER TABLE public.report_financials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_report_financials" ON public.report_financials;
CREATE POLICY "service_role_all_report_financials"
  ON public.report_financials FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'tickets_unit_board_request',
    label:       'Ticket unit + board-request fields',
    description: 'tickets.unit_number',
    filename:    '20260523_tickets_unit_board_request.sql',
    artifact:    { type: 'column', table: 'tickets', column: 'unit_number' },
    sql: `ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS unit_number      text,
  ADD COLUMN IF NOT EXISTS is_board_request boolean NOT NULL DEFAULT false;`,
  },
  {
    key:         'tickets_requested_by',
    label:       'Ticket "requested by"',
    description: 'tickets.requested_by',
    filename:    '20260523_tickets_requested_by.sql',
    artifact:    { type: 'column', table: 'tickets', column: 'requested_by' },
    sql: `ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS requested_by text;`,
  },
  {
    key:         'monthly_reports_publish',
    label:       'Publish state for monthly reports',
    description: 'monthly_reports.published_at',
    filename:    '20260522_monthly_reports_publish.sql',
    artifact:    { type: 'column', table: 'monthly_reports', column: 'published_at' },
    sql: `ALTER TABLE public.monthly_reports
  ADD COLUMN IF NOT EXISTS published_at        timestamptz,
  ADD COLUMN IF NOT EXISTS published_audience  text,
  ADD COLUMN IF NOT EXISTS published_by_email  text;

ALTER TABLE public.monthly_reports
  DROP CONSTRAINT IF EXISTS monthly_reports_published_audience_chk;
ALTER TABLE public.monthly_reports
  ADD CONSTRAINT monthly_reports_published_audience_chk
  CHECK (published_audience IS NULL OR published_audience IN ('board', 'owners', 'both'));

CREATE INDEX IF NOT EXISTS monthly_reports_published_idx
  ON public.monthly_reports (association_code, published_at DESC)
  WHERE published_at IS NOT NULL;`,
  },
  {
    key:         'tickets_created_by_maia',
    label:       'MAIA AI auto-resolution flag',
    description: 'tickets.created_by_maia',
    filename:    '20260523_tickets_created_by_maia.sql',
    artifact:    { type: 'column', table: 'tickets', column: 'created_by_maia' },
    sql: `ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS created_by_maia boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tickets_created_by_maia_idx
  ON public.tickets (association_code, resolved_at DESC)
  WHERE created_by_maia = true;`,
  },
  {
    key:         'report_feedback',
    label:       'Report email + feedback loop',
    description: 'report_feedback table',
    filename:    '20260522_report_feedback.sql',
    artifact:    { type: 'table', table: 'report_feedback' },
    sql: `CREATE TABLE IF NOT EXISTS public.report_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         uuid        NOT NULL REFERENCES public.monthly_reports(id) ON DELETE CASCADE,
  recipient_type    text        NOT NULL CHECK (recipient_type IN ('board', 'owner')),
  recipient_email   text        NOT NULL,
  recipient_name    text,
  recipient_label   text,
  feedback_token    text        NOT NULL UNIQUE,
  rating            int         CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  feedback          text,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  UNIQUE (report_id, recipient_email)
);
CREATE INDEX IF NOT EXISTS report_feedback_report_idx
  ON public.report_feedback (report_id, recipient_type);
CREATE INDEX IF NOT EXISTS report_feedback_token_idx
  ON public.report_feedback (feedback_token);
ALTER TABLE public.report_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_report_feedback" ON public.report_feedback;
CREATE POLICY "service_role_all_report_feedback"
  ON public.report_feedback FOR ALL TO service_role USING (true);`,
  },
  {
    key:         'tickets_category',
    label:       'Ticket category field',
    description: 'tickets.ticket_category',
    filename:    '20260525_tickets_category.sql',
    artifact:    { type: 'column', table: 'tickets', column: 'ticket_category' },
    sql: `ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS ticket_category text;

CREATE INDEX IF NOT EXISTS tickets_category_idx
  ON public.tickets (ticket_category, updated_at DESC)
  WHERE ticket_category IS NOT NULL;`,
  },
  {
    key:         'invoice_intake_drafts',
    label:       'Invoice intake queue',
    description: 'invoice_intake_drafts table — Karen reviews each inbound invoice PDF before pushing to CINC',
    filename:    '20260525_invoice_intake_drafts.sql',
    artifact:    { type: 'table', table: 'invoice_intake_drafts' },
    sql: `CREATE TABLE IF NOT EXISTS public.invoice_intake_drafts (
  id                         bigserial PRIMARY KEY,
  -- Dedupe key (Pub/Sub retries): the Gmail message id of the
  -- inbound email, available at intake time before logEmail runs.
  gmail_message_id           text,
  -- Optional FK cross-link to email_logs (populated by a backfill or
  -- later code path; not required for dedupe).
  source_email_id            uuid REFERENCES public.email_logs(id) ON DELETE SET NULL,
  ticket_id                  bigint REFERENCES public.tickets(id) ON DELETE SET NULL,
  pdf_storage_key            text,
  -- What MAIA extracted (Karen-editable):
  extracted_vendor_name      text,
  matched_cinc_vendor_id     text,
  matched_vendor_name        text,
  matched_vendor_short_name  text,
  extracted_invoice_number   text,
  extracted_amount           numeric(12,2),
  extracted_association_code text,
  extracted_invoice_date     date,
  extraction_confidence      real,
  -- State machine:
  status                     text NOT NULL CHECK (status IN
                               ('pending_review','ready_to_push','needs_vendor','duplicate_in_cinc',
                                'pushed_to_cinc','rejected')),
  rejected_reason            text,
  -- Post-push:
  cinc_invoice_id            text,
  cinc_dup_invoice_id        text,
  pushed_at                  timestamptz,
  pushed_by                  text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_intake_drafts_status_idx
  ON public.invoice_intake_drafts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS invoice_intake_drafts_created_idx
  ON public.invoice_intake_drafts (created_at DESC);

-- Idempotency on the Gmail message id so Pub/Sub retries don't create
-- duplicate drafts. Same lesson as the append-ack spam fix (PR #179).
CREATE UNIQUE INDEX IF NOT EXISTS invoice_intake_drafts_gmail_msg_uniq
  ON public.invoice_intake_drafts (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_drive_file_id',
    label:       'Invoice intake — Drive mirror',
    description: 'invoice_intake_drafts.drive_file_id — Google Drive file id of the renamed copy mirrored into INVOICE TO INPUT folder on Push to CINC',
    filename:    '20260525_invoice_intake_drive_file_id.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'drive_file_id' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS drive_file_id text;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_gl_account',
    label:       'Invoice intake — GL line',
    description: 'invoice_intake_drafts.gl_account_id + gl_account_name — Karen picks the GL line from the association budget so reports match expenses-vs-budget',
    filename:    '20260525_invoice_intake_gl_account.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'gl_account_id' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS gl_account_id   text,
  ADD COLUMN IF NOT EXISTS gl_account_name text;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_pay_observation',
    label:       'Invoice intake — payment + observation',
    description: 'invoice_intake_drafts.pay_by_type + observation_note — payment method (ACH/Check) per invoice, and a free-text observation that maps to CINC NoteDescription so the CINC team sees processing instructions',
    filename:    '20260525_invoice_intake_pay_observation.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'pay_by_type' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS pay_by_type      text,
  ADD COLUMN IF NOT EXISTS observation_note text;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_work_order_number',
    label:       'Invoice intake — work order link',
    description: 'invoice_intake_drafts.work_order_number — Karen links a maintenance invoice to an existing CINC work order so it shows up under that WO instead of standalone',
    filename:    '20260525_invoice_intake_work_order_number.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'work_order_number' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS work_order_number integer;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_pay_from_bank_account',
    label:       'Invoice intake — pay-from bank account',
    description: 'invoice_intake_drafts.pay_from_bank_account_id — CINC BankAccountID for the Operating / Reserve / Special Assessment account to pay this invoice from. Maps directly to PayFromBankAccountID on createInvoice. NULL = CINC default (operating).',
    filename:    '20260527_invoice_intake_pay_from_bank_account.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'pay_from_bank_account_id' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS pay_from_bank_account_id bigint;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'bank_reconciliation_entries',
    label:       'Bank reconciliation — entries table',
    description: 'bank_reconciliation_entries — per-(assoc, bank account, date) ledger for the /admin/reconciliation page. Replaces Isabela\'s manual Google-Sheet workflow. Two source kinds: cinc-auto and manual. Includes explicit GRANT block per Supabase\'s 2026-10-30 auto-grant removal.',
    filename:    '20260527_bank_reconciliation_entries.sql',
    artifact:    { type: 'table', table: 'bank_reconciliation_entries' },
    sql: `CREATE TABLE IF NOT EXISTS public.bank_reconciliation_entries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code            text        NOT NULL,
  bank_account_id             bigint      NOT NULL,
  bank_account_description    text,
  source                      text        NOT NULL CHECK (source IN ('cinc', 'manual')),
  cinc_invoice_id             bigint,
  cinc_payment_id             text,
  effective_date              date        NOT NULL,
  customer                    text,
  vendor_payee                text,
  description                 text,
  invoice_number              text,
  amount                      numeric(14,2) NOT NULL,
  paid_type                   text,
  additional_notes            text,
  invoice_attached_url        text,
  running_balance             numeric(14,2),
  pmi_coordinator_notes       text,
  reconciled_at               timestamptz,
  reconciled_by               text,
  entered_by                  text        NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_rec_cinc_payment_uniq
  ON public.bank_reconciliation_entries (cinc_payment_id)
  WHERE cinc_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bank_rec_cinc_invoice_dedupe
  ON public.bank_reconciliation_entries (cinc_invoice_id, amount, effective_date)
  WHERE source = 'cinc' AND cinc_payment_id IS NULL;

CREATE INDEX IF NOT EXISTS bank_rec_assoc_account_date_idx
  ON public.bank_reconciliation_entries (association_code, bank_account_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS bank_rec_unreconciled_idx
  ON public.bank_reconciliation_entries (association_code, bank_account_id)
  WHERE reconciled_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_entries
  TO anon, authenticated, service_role;

ALTER TABLE public.bank_reconciliation_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_bank_reconciliation_entries" ON public.bank_reconciliation_entries;
CREATE POLICY "service_role_all_bank_reconciliation_entries"
  ON public.bank_reconciliation_entries FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'bank_reconciliation_gl_trans_id',
    label:       'Bank reconciliation — GL transaction ID column',
    description: 'bank_reconciliation_entries.cinc_gl_trans_id — stable dedupe key for the glTransactions sync path. CINC GLTransID is unique per transaction; replaces the (cinc_invoice_id, amount, effective_date) synthetic key used for the MAIA-only sync.',
    filename:    '20260528_bank_reconciliation_gl_trans_id.sql',
    artifact:    { type: 'column', table: 'bank_reconciliation_entries', column: 'cinc_gl_trans_id' },
    sql: `ALTER TABLE public.bank_reconciliation_entries
  ADD COLUMN IF NOT EXISTS cinc_gl_trans_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS bank_rec_cinc_gl_trans_uniq
  ON public.bank_reconciliation_entries (cinc_gl_trans_id)
  WHERE cinc_gl_trans_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'association_insurance_policies',
    label:       'Association master-insurance compliance',
    description: 'association_insurance_policies — FL HOA/condo master-policy checklist (D&O, fidelity, master property, flood, windstorm, etc.) with dates, coverage, COI, waiver + versioning. Also extends compliance_alerts.alert_type to allow assoc_insurance_expiring/expired so the daily cron can alert on association-level policy expiry.',
    filename:    '20260529_association_insurance_policies.sql',
    artifact:    { type: 'table', table: 'association_insurance_policies' },
    sql: `create table if not exists public.association_insurance_policies (
  id                   bigint generated always as identity primary key,
  association_code     text        not null,
  policy_type          text        not null,
  carrier              text,
  policy_number        text,
  named_insured        text,
  effective_date       date,
  expiration_date      date,
  coverage_amount_usd  numeric(14,2),
  premium_usd          numeric(12,2),
  agent_name           text,
  agent_email          text,
  agent_phone          text,
  coi_storage_path     text,
  coi_filename         text,
  coi_mime_type        text,
  coi_file_size_bytes  bigint,
  waived               boolean     not null default false,
  waived_reason        text,
  notes                text,
  archived_at          timestamptz,
  archived_by_email    text,
  created_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_assoc_ins_code on public.association_insurance_policies(association_code);
create index if not exists idx_assoc_ins_type on public.association_insurance_policies(policy_type);
create index if not exists idx_assoc_ins_exp  on public.association_insurance_policies(expiration_date);
create index if not exists idx_assoc_ins_active on public.association_insurance_policies(archived_at) where archived_at is null;

create unique index if not exists uq_assoc_ins_active
  on public.association_insurance_policies(association_code, policy_type)
  where archived_at is null;

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.association_insurance_policies;
create trigger set_updated_at before update on public.association_insurance_policies
  for each row execute function public.tg_set_updated_at();

grant select, insert, update, delete on public.association_insurance_policies
  to anon, authenticated, service_role;

alter table public.association_insurance_policies enable row level security;

drop policy if exists service_all on public.association_insurance_policies;
create policy service_all on public.association_insurance_policies
  for all to service_role using (true) with check (true);

drop policy if exists auth_read on public.association_insurance_policies;
create policy auth_read on public.association_insurance_policies
  for select to authenticated using (true);

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'compliance_alerts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%alert_type%'
  loop
    execute format('alter table public.compliance_alerts drop constraint %I', c.conname);
  end loop;

  alter table public.compliance_alerts
    add constraint compliance_alerts_alert_type_check
    check (alert_type in (
      'lease_expiring','lease_expired',
      'insurance_expiring','insurance_expired',
      'violation_due','violation_overdue',
      'cou_expiring','cou_expired',
      'assoc_insurance_expiring','assoc_insurance_expired'
    ));
end $$;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'association_safety_inspections',
    label:       'FL structural-safety inspections',
    description: 'association_safety_inspections — Milestone / SIRS / Wind Mitigation / Roof tracking with year-built + stories, last-completed + next-due dates, report upload, waiver + versioning. Also extends compliance_alerts.alert_type to the full union incl. inspection_due/inspection_overdue so the daily cron + dashboard deadline tracker (I7) can alert on inspection deadlines.',
    filename:    '20260529_association_safety_inspections.sql',
    artifact:    { type: 'table', table: 'association_safety_inspections' },
    sql: `create table if not exists public.association_safety_inspections (
  id                   bigint generated always as identity primary key,
  association_code     text        not null,
  inspection_type      text        not null,
  building_label       text,
  year_built           int,
  stories              int,
  coastal              boolean     not null default false,
  last_completed_date  date,
  next_due_date        date,
  provider             text,
  report_storage_path  text,
  report_filename      text,
  report_mime_type     text,
  report_file_size_bytes bigint,
  waived               boolean     not null default false,
  waived_reason        text,
  notes                text,
  archived_at          timestamptz,
  archived_by_email    text,
  created_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_assoc_safe_code on public.association_safety_inspections(association_code);
create index if not exists idx_assoc_safe_type on public.association_safety_inspections(inspection_type);
create index if not exists idx_assoc_safe_due  on public.association_safety_inspections(next_due_date);
create index if not exists idx_assoc_safe_active on public.association_safety_inspections(archived_at) where archived_at is null;

create unique index if not exists uq_assoc_safe_active
  on public.association_safety_inspections(association_code, inspection_type, coalesce(building_label, ''))
  where archived_at is null;

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.association_safety_inspections;
create trigger set_updated_at before update on public.association_safety_inspections
  for each row execute function public.tg_set_updated_at();

grant select, insert, update, delete on public.association_safety_inspections
  to anon, authenticated, service_role;

alter table public.association_safety_inspections enable row level security;

drop policy if exists service_all on public.association_safety_inspections;
create policy service_all on public.association_safety_inspections
  for all to service_role using (true) with check (true);

drop policy if exists auth_read on public.association_safety_inspections;
create policy auth_read on public.association_safety_inspections
  for select to authenticated using (true);

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'compliance_alerts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%alert_type%'
  loop
    execute format('alter table public.compliance_alerts drop constraint %I', c.conname);
  end loop;

  alter table public.compliance_alerts
    add constraint compliance_alerts_alert_type_check
    check (alert_type in (
      'lease_expiring','lease_expired',
      'insurance_expiring','insurance_expired',
      'violation_due','violation_overdue',
      'cou_expiring','cou_expired',
      'assoc_insurance_expiring','assoc_insurance_expired',
      'inspection_due','inspection_overdue'
    ));
end $$;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'compliance_drive_links',
    label:       'Compliance Drive links',
    description: 'association_insurance_policies.drive_url + association_safety_inspections.drive_url — lets a policy/inspection point at a Google Drive file instead of an uploaded one, so staff can paste/update the link from the screen (not every file needs to live in the system). See COMPLIANCE_TRACKING.md.',
    filename:    '20260529_compliance_drive_links.sql',
    artifact:    { type: 'column', table: 'association_insurance_policies', column: 'drive_url' },
    sql: `alter table public.association_insurance_policies
  add column if not exists drive_url text;

alter table public.association_safety_inspections
  add column if not exists drive_url text;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'association_annual_reports',
    label:       'Sunbiz annual report tracker',
    description: 'association_annual_reports — per-(association, year) FL Sunbiz annual report filing record (filed_date, confirmation_number, fee_paid, notes). Also extends compliance_alerts.alert_type to the full union incl. sunbiz_due/sunbiz_overdue. Powers /admin/sunbiz + the dashboard Building Compliance deadline surfacing (I8).',
    filename:    '20260529_association_annual_reports.sql',
    artifact:    { type: 'table', table: 'association_annual_reports' },
    sql: `create table if not exists public.association_annual_reports (
  id                   bigint generated always as identity primary key,
  association_code     text        not null,
  report_year          int         not null,
  filed_date           date,
  confirmation_number  text,
  fee_paid_usd         numeric(8,2),
  filed_by_email       text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (association_code, report_year)
);

create index if not exists idx_annual_reports_code on public.association_annual_reports(association_code);
create index if not exists idx_annual_reports_year on public.association_annual_reports(report_year);

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists set_updated_at on public.association_annual_reports;
create trigger set_updated_at before update on public.association_annual_reports
  for each row execute function public.tg_set_updated_at();

grant select, insert, update, delete on public.association_annual_reports
  to anon, authenticated, service_role;

alter table public.association_annual_reports enable row level security;

drop policy if exists service_all on public.association_annual_reports;
create policy service_all on public.association_annual_reports
  for all to service_role using (true) with check (true);

drop policy if exists auth_read on public.association_annual_reports;
create policy auth_read on public.association_annual_reports
  for select to authenticated using (true);

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'compliance_alerts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%alert_type%'
  loop
    execute format('alter table public.compliance_alerts drop constraint %I', c.conname);
  end loop;

  alter table public.compliance_alerts
    add constraint compliance_alerts_alert_type_check
    check (alert_type in (
      'lease_expiring','lease_expired',
      'insurance_expiring','insurance_expired',
      'violation_due','violation_overdue',
      'cou_expiring','cou_expired',
      'assoc_insurance_expiring','assoc_insurance_expired',
      'inspection_due','inspection_overdue',
      'sunbiz_due','sunbiz_overdue'
    ));
end $$;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'scheduled_payments',
    label:       'Reconciliation upcoming/future payments',
    description: 'scheduled_payments table — manual future payments (insurance installments etc.) for the reconciliation "Upcoming Payments" section; installment series + carry-forward.',
    filename:    '20260530_scheduled_payments.sql',
    artifact:    { type: 'table', table: 'scheduled_payments' },
    sql: `create table if not exists public.scheduled_payments (
  id                bigint generated always as identity primary key,
  association_code  text        not null,
  bank_account_id   bigint,
  due_month         text        not null,
  due_date          date,
  vendor_payee      text,
  description       text,
  category          text,
  amount            numeric(14,2) not null,
  direction         text        not null default 'outflow' check (direction in ('outflow','inflow')),
  series_id         uuid,
  status            text        not null default 'pending' check (status in ('pending','paid','cancelled')),
  paid_date         date,
  notes             text,
  created_by_email  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_sched_pay_assoc  on public.scheduled_payments(association_code);
create index if not exists idx_sched_pay_month  on public.scheduled_payments(due_month);
create index if not exists idx_sched_pay_status on public.scheduled_payments(status);
create index if not exists idx_sched_pay_series on public.scheduled_payments(series_id);
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists set_updated_at on public.scheduled_payments;
create trigger set_updated_at before update on public.scheduled_payments
  for each row execute function public.tg_set_updated_at();
grant select, insert, update, delete on public.scheduled_payments to anon, authenticated, service_role;
alter table public.scheduled_payments enable row level security;
drop policy if exists service_all on public.scheduled_payments;
create policy service_all on public.scheduled_payments for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.scheduled_payments;
create policy auth_read on public.scheduled_payments for select to authenticated using (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_dates',
    label:       'Invoice due + scheduled-pay dates',
    description: 'invoice_intake_drafts.due_date + scheduled_pay_date — invoice due date (→ CINC DueDate) and the date PMI plans to pay, for cash-flow timing + the reconciliation Upcoming Payments section.',
    filename:    '20260530_invoice_intake_dates.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'scheduled_pay_date' },
    sql: `alter table public.invoice_intake_drafts
  add column if not exists due_date           date,
  add column if not exists scheduled_pay_date date;

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'upcoming_lifecycle',
    label:       'Upcoming-payments lifecycle',
    description: 'recurring_estimate_dismissals (hide wrong MAIA estimates) + scheduled_payments.matched_gl_trans_id (auto-clear manual future payments when the real payment posts).',
    filename:    '20260530_upcoming_lifecycle.sql',
    artifact:    { type: 'table', table: 'recurring_estimate_dismissals' },
    sql: `create table if not exists public.recurring_estimate_dismissals (
  id                 bigint generated always as identity primary key,
  association_code   text        not null,
  vendor_key         text        not null,
  dismissed_by_email text,
  created_at         timestamptz not null default now(),
  unique (association_code, vendor_key)
);
create index if not exists idx_recur_dismiss_assoc on public.recurring_estimate_dismissals(association_code);
grant select, insert, update, delete on public.recurring_estimate_dismissals to anon, authenticated, service_role;
alter table public.recurring_estimate_dismissals enable row level security;
drop policy if exists service_all on public.recurring_estimate_dismissals;
create policy service_all on public.recurring_estimate_dismissals for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.recurring_estimate_dismissals;
create policy auth_read on public.recurring_estimate_dismissals for select to authenticated using (true);
alter table public.scheduled_payments add column if not exists matched_gl_trans_id bigint;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'recurring_services',
    label:       'Recurring vendor services',
    description: 'vendor_employees + recurring_services + service_visits — fixed weekly vendors per association (landscaping/pool/janitorial/pest), their crew, and per-week visit instances (each becomes a work order for photos + reports).',
    filename:    '20260531_recurring_services.sql',
    artifact:    { type: 'table', table: 'recurring_services' },
    sql: `create table if not exists public.vendor_employees (
  id                uuid primary key default gen_random_uuid(),
  cinc_vendor_id    text,
  vendor_name       text        not null,
  name              text        not null,
  phone             text,
  email             text,
  preferred_channel text        not null default 'email' check (preferred_channel in ('email','sms','whatsapp')),
  active            boolean      not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_vendor_employees_vendor on public.vendor_employees(cinc_vendor_id);

create table if not exists public.recurring_services (
  id               bigint generated always as identity primary key,
  association_code text        not null,
  cinc_vendor_id   text,
  vendor_name      text        not null,
  service_type     text        not null,
  cadence          text        not null default 'weekly' check (cadence in ('daily','weekly','biweekly','monthly')),
  billing_cadence  text        not null default 'monthly' check (billing_cadence in ('per_visit','weekly','monthly')),
  expected_day     smallint    check (expected_day between 0 and 6),
  office_email     text,
  active           boolean      not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (association_code, cinc_vendor_id, service_type)
);
create index if not exists idx_recurring_services_assoc on public.recurring_services(association_code);

create table if not exists public.service_visits (
  id                   bigint generated always as identity primary key,
  recurring_service_id bigint      references public.recurring_services(id) on delete cascade,
  association_code     text        not null,
  cinc_vendor_id       text,
  vendor_name          text,
  service_type         text,
  week_of              date        not null,
  status               text        not null default 'expected' check (status in ('expected','confirmed','photos_received','missed')),
  ticket_id            bigint      references public.tickets(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (recurring_service_id, week_of)
);
create index if not exists idx_service_visits_week  on public.service_visits(week_of);
create index if not exists idx_service_visits_assoc on public.service_visits(association_code);

grant select, insert, update, delete on public.vendor_employees   to anon, authenticated, service_role;
grant select, insert, update, delete on public.recurring_services to anon, authenticated, service_role;
grant select, insert, update, delete on public.service_visits     to anon, authenticated, service_role;
alter table public.vendor_employees   enable row level security;
alter table public.recurring_services enable row level security;
alter table public.service_visits     enable row level security;
drop policy if exists service_all on public.vendor_employees;
create policy service_all on public.vendor_employees   for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.vendor_employees;
create policy auth_read on public.vendor_employees   for select to authenticated using (true);
drop policy if exists service_all on public.recurring_services;
create policy service_all on public.recurring_services for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.recurring_services;
create policy auth_read on public.recurring_services for select to authenticated using (true);
drop policy if exists service_all on public.service_visits;
create policy service_all on public.service_visits     for all to service_role using (true) with check (true);
drop policy if exists auth_read on public.service_visits;
create policy auth_read on public.service_visits     for select to authenticated using (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'vendor_language',
    label:       'Vendor + crew preferred language',
    description: 'vendor_employees.preferred_language + recurring_services.office_language — send links/messages in the vendor/crew language; reports are translated to English for storage.',
    filename:    '20260531_vendor_language.sql',
    artifact:    { type: 'column', table: 'vendor_employees', column: 'preferred_language' },
    sql: `alter table public.vendor_employees   add column if not exists preferred_language text not null default 'en';
alter table public.recurring_services add column if not exists office_language    text not null default 'en';
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'service_visit_agenda',
    label:       'Service visit agenda (crew + planned date)',
    description: 'service_visits.planned_date + assigned_employee_ids + confirmed_at — the vendor office confirms next week\'s crew + day via the Friday agenda link.',
    filename:    '20260531_service_visit_agenda.sql',
    artifact:    { type: 'column', table: 'service_visits', column: 'planned_date' },
    sql: `alter table public.service_visits
  add column if not exists planned_date          date,
  add column if not exists assigned_employee_ids uuid[] not null default '{}',
  add column if not exists confirmed_at           timestamptz;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'recurring_schedule_anchor',
    label:       'Recurring schedule anchor (cadence-accurate flags)',
    description: 'recurring_services.schedule_anchor (biweekly parity reference Monday) + monthly_day (1–31, monthly target day) + widen cadence check to include daily — drives cadence-aware visit generation + weekly-coverage flags so non-weekly services only flag on weeks they are actually due.',
    filename:    '20260601_recurring_schedule_anchor.sql',
    artifact:    { type: 'column', table: 'recurring_services', column: 'schedule_anchor' },
    sql: `alter table public.recurring_services
  add column if not exists schedule_anchor date,
  add column if not exists monthly_day     smallint check (monthly_day between 1 and 31);
alter table public.recurring_services drop constraint if exists recurring_services_cadence_check;
alter table public.recurring_services
  add constraint recurring_services_cadence_check check (cadence in ('daily','weekly','biweekly','monthly'));
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_audit_checklist',
    label:       'Invoice intake audit checklist',
    description: 'invoice_intake_drafts.audit_checklist (jsonb per-field checks) + audit_ready_by/at + status \'ready_to_push\' — AP team green-checks each field before Karen can push.',
    filename:    '20260602_invoice_intake_audit_checklist.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'audit_checklist' },
    sql: `alter table public.invoice_intake_drafts
  add column if not exists audit_checklist jsonb       not null default '{}'::jsonb,
  add column if not exists audit_ready_by  text,
  add column if not exists audit_ready_at  timestamptz;
alter table public.invoice_intake_drafts drop constraint if exists invoice_intake_drafts_status_check;
alter table public.invoice_intake_drafts
  add constraint invoice_intake_drafts_status_check check (status in
    ('pending_review','ready_to_push','needs_vendor','duplicate_in_cinc','pushed_to_cinc','rejected'));
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'association_match_aliases',
    label:       'Association match aliases',
    description: 'associations.match_aliases (text[]) — curated common-name aliases ("One Bay Harbor" → ONE) so MAIA maps invoices/work orders to the right association. Seed values via APPLY_association_aliases_seed.sql.',
    filename:    '20260601_association_match_aliases.sql',
    artifact:    { type: 'column', table: 'associations', column: 'match_aliases' },
    sql: `alter table public.associations
  add column if not exists match_aliases text[] not null default '{}';
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'maia_improvement_ideas',
    label:       'MAIA improvement ideas',
    description: 'maia_improvement_ideas table — staff "make MAIA better" suggestions submitted via the daily-news email link; triaged on /admin/ideas (new → accepted → done, or deleted).',
    filename:    '20260603_maia_improvement_ideas.sql',
    artifact:    { type: 'table', table: 'maia_improvement_ideas' },
    sql: `CREATE TABLE IF NOT EXISTS public.maia_improvement_ideas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea               text        NOT NULL,
  submitted_by_name  text,
  submitted_by_email text,
  source             text        NOT NULL DEFAULT 'daily_news',
  status             text        NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','accepted','done','deleted')),
  triaged_by         text,
  triaged_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maia_improvement_ideas_status_created_idx
  ON public.maia_improvement_ideas (status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maia_improvement_ideas
  TO anon, authenticated, service_role;
ALTER TABLE public.maia_improvement_ideas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_maia_improvement_ideas" ON public.maia_improvement_ideas;
CREATE POLICY "service_role_all_maia_improvement_ideas"
  ON public.maia_improvement_ideas FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_on_hold',
    label:       'Invoice On Hold state',
    description: "invoice_intake_drafts: 'on_hold' status + hold_requested_items / hold_ticket_id / hold_requested_at / hold_note — hold an invoice while collecting missing vendor docs (COI/license/W-9/ACH).",
    filename:    '20260604_invoice_on_hold.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'hold_requested_items' },
    sql: `ALTER TABLE public.invoice_intake_drafts DROP CONSTRAINT IF EXISTS invoice_intake_drafts_status_check;
ALTER TABLE public.invoice_intake_drafts
  ADD CONSTRAINT invoice_intake_drafts_status_check CHECK (status IN
    ('pending_review','ready_to_push','needs_vendor','duplicate_in_cinc','pushed_to_cinc','rejected','on_hold'));
ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS hold_requested_items text[],
  ADD COLUMN IF NOT EXISTS hold_ticket_id        bigint,
  ADD COLUMN IF NOT EXISTS hold_requested_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hold_note             text;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'vendor_doc_extraction',
    label:       'Vendor doc AI extraction',
    description: 'work_order_attachments: extracted_doc_type / extracted_data / extracted_at — Claude classifies + reads vendor docs (W-9/COI/ACH/license) on upload, before compression.',
    filename:    '20260605_vendor_doc_extraction.sql',
    artifact:    { type: 'column', table: 'work_order_attachments', column: 'extracted_doc_type' },
    sql: `ALTER TABLE public.work_order_attachments
  ADD COLUMN IF NOT EXISTS extracted_doc_type text,
  ADD COLUMN IF NOT EXISTS extracted_data     jsonb,
  ADD COLUMN IF NOT EXISTS extracted_at       timestamptz;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_intake_per_attachment_uniq',
    label:       'Invoice intake — per-attachment dedupe (multi-PDF fix)',
    description: 'invoice_intake_drafts.gmail_attachment_id + a unique index on (gmail_message_id, coalesce(gmail_attachment_id,\'\')) replacing the per-email index — fixes multi-PDF emails creating only one draft (PDFs 2..N were hitting the gmail_message_id unique index and being swallowed as 23505).',
    filename:    '20260605_invoice_intake_per_attachment_uniq.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'gmail_attachment_id' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS gmail_attachment_id text;
DROP INDEX IF EXISTS public.invoice_intake_drafts_gmail_msg_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_intake_drafts_gmail_msg_att_uniq
  ON public.invoice_intake_drafts (gmail_message_id, coalesce(gmail_attachment_id, ''))
  WHERE gmail_message_id IS NOT NULL;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'reconciliation_paid_and_daily_tickets',
    label:       'Reconciliation — paid stamp + daily tickets',
    description: 'bank_reconciliation_entries.paid_at/paid_by (Jonathan marks EFT invoices paid) + tickets.recon_date (one daily reconciliation ticket per staffer per day, partial-unique) — powers the "To Pay in CINC" box + the per-person daily reconciliation ticket for the monthly report.',
    filename:    '20260605_reconciliation_paid_and_daily_tickets.sql',
    artifact:    { type: 'column', table: 'bank_reconciliation_entries', column: 'paid_by' },
    sql: `ALTER TABLE public.bank_reconciliation_entries
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by text;
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS recon_date date;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_recon_daily_uniq
  ON public.tickets (assignee_email, recon_date)
  WHERE recon_date IS NOT NULL;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'ai_call_circuit_breaker',
    label:       'Global Claude circuit breaker',
    description: 'ai_call_log table + record_ai_call(p_cap) function — global rolling 5-minute cap on Claude API calls (backs lib/anthropic-guard.ts). Applying this ARMS the breaker; until then the guard fails open. Backstop against runaway API spend (2026-06-06 webhook-loop incident).',
    filename:    '20260606_ai_call_circuit_breaker.sql',
    artifact:    { type: 'table', table: 'ai_call_log' },
    sql: `create table if not exists public.ai_call_log (
  minute_bucket timestamptz primary key,
  call_count    int not null default 0
);
create index if not exists ai_call_log_recent_idx on public.ai_call_log (minute_bucket desc);
grant select, insert, update, delete on public.ai_call_log to service_role;
create or replace function public.record_ai_call(p_cap int)
returns boolean language plpgsql security definer set search_path = public as $$
declare total int;
begin
  insert into public.ai_call_log (minute_bucket, call_count)
    values (date_trunc('minute', now()), 1)
    on conflict (minute_bucket) do update set call_count = public.ai_call_log.call_count + 1;
  select coalesce(sum(call_count), 0) into total
    from public.ai_call_log where minute_bucket > now() - interval '5 minutes';
  delete from public.ai_call_log where minute_bucket < now() - interval '1 hour';
  return total <= p_cap;
end $$;
grant execute on function public.record_ai_call(int) to service_role;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'gmail_cooldown',
    label:       'Gmail 429 self-healing cooldown',
    description: 'maia_watch_state.gmail_cooldown_until + staff_gmail_accounts.gmail_cooldown_until — when the webhook hits a Gmail rate-limit (429) it parks a cooldown until the Retry-After time and skips Gmail calls until then, so the per-user quota resets instead of being kept hot (2026-06-06 maia@ stall).',
    filename:    '20260606_gmail_cooldown.sql',
    artifact:    { type: 'column', table: 'maia_watch_state', column: 'gmail_cooldown_until' },
    sql: `ALTER TABLE public.maia_watch_state
  ADD COLUMN IF NOT EXISTS gmail_cooldown_until timestamptz;
ALTER TABLE public.staff_gmail_accounts
  ADD COLUMN IF NOT EXISTS gmail_cooldown_until timestamptz;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'invoice_dedup_by_filename',
    label:       'Invoice intake dedup by stable filename',
    description: 'invoice_intake_drafts.attachment_filename + unique index (gmail_message_id, attachment_filename). Fixes the 2026-06-07 mass-duplicate incident: Gmail attachmentId is volatile (changes every fetch), so the old (message_id, attachment_id) dedup never matched and each reprocess inserted a fresh dup. Filename is stable. Apply BEFORE re-enabling maia@ intake.',
    filename:    '20260607_invoice_dedup_by_filename.sql',
    artifact:    { type: 'column', table: 'invoice_intake_drafts', column: 'attachment_filename' },
    sql: `ALTER TABLE public.invoice_intake_drafts
  ADD COLUMN IF NOT EXISTS attachment_filename text;
DROP INDEX IF EXISTS public.invoice_intake_drafts_gmail_msg_att_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_intake_drafts_msg_filename_uniq
  ON public.invoice_intake_drafts (gmail_message_id, attachment_filename)
  WHERE attachment_filename IS NOT NULL;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'woa_cinc_pushed_at',
    label:       'WO photos → CINC push',
    description: 'work_order_attachments.cinc_pushed_at (idempotency stamp so a MAIA-origin photo is pushed into CINC exactly once) + widens the integration_outbox entity_type CHECK to allow the new ("work_order_attachment","push_photo") outbox event. Apply before deploying the WO-photo push.',
    filename:    '20260607_wo_photos_to_cinc.sql',
    artifact:    { type: 'column', table: 'work_order_attachments', column: 'cinc_pushed_at' },
    sql: `ALTER TABLE public.work_order_attachments
  ADD COLUMN IF NOT EXISTS cinc_pushed_at timestamptz;

-- Allow the new outbox event kind ('work_order_attachment','push_photo').
ALTER TABLE public.integration_outbox
  DROP CONSTRAINT IF EXISTS chk_outbox_entity_type;
ALTER TABLE public.integration_outbox
  ADD CONSTRAINT chk_outbox_entity_type
  CHECK (entity_type IN ('ticket', 'ticket_message', 'work_order_attachment'));

NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'preventive_schedules',
    label:       'Preventive maintenance schedules',
    description: 'preventive_schedules table — per-association recurring maintenance tasks (cadence: weekly/monthly/quarterly/semiannual/annual) behind the Association Hub Maintenance tab + calendar. Apply before the Maintenance tab can save schedules.',
    filename:    '20260608_preventive_schedules.sql',
    artifact:    { type: 'table', table: 'preventive_schedules' },
    sql: `CREATE TABLE IF NOT EXISTS public.preventive_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  task             text        NOT NULL,
  cadence          text        NOT NULL,
  weekday          integer,
  day_of_month     integer,
  start_date       date        NOT NULL,
  vendor_name      text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_prev_cadence CHECK (cadence IN ('weekly','monthly','quarterly','semiannual','annual'))
);
CREATE INDEX IF NOT EXISTS preventive_schedules_assoc_idx
  ON public.preventive_schedules (association_code) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventive_schedules
  TO anon, authenticated, service_role;
ALTER TABLE public.preventive_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_preventive_schedules" ON public.preventive_schedules;
CREATE POLICY "service_role_all_preventive_schedules"
  ON public.preventive_schedules FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'preventive_schedules_category',
    label:       'Calendar governance dates',
    description: 'preventive_schedules.category (maintenance|governance) — lets the Maintenance calendar carry per-condo-docs governance dates (budget preparation, annual election, annual meeting, reserve-study due) alongside preventive maintenance. Self-sufficient: also creates the table if the base migration was never applied.',
    filename:    '20260608_preventive_schedules_category.sql',
    artifact:    { type: 'column', table: 'preventive_schedules', column: 'category' },
    sql: `CREATE TABLE IF NOT EXISTS public.preventive_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  task             text        NOT NULL,
  category         text        NOT NULL DEFAULT 'maintenance',
  cadence          text        NOT NULL,
  weekday          integer,
  day_of_month     integer,
  start_date       date        NOT NULL,
  vendor_name      text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_prev_cadence CHECK (cadence IN ('weekly','monthly','quarterly','semiannual','annual'))
);
ALTER TABLE public.preventive_schedules
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'maintenance';
ALTER TABLE public.preventive_schedules DROP CONSTRAINT IF EXISTS chk_prev_category;
ALTER TABLE public.preventive_schedules
  ADD CONSTRAINT chk_prev_category CHECK (category IN ('maintenance','governance'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventive_schedules
  TO anon, authenticated, service_role;
ALTER TABLE public.preventive_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_preventive_schedules" ON public.preventive_schedules;
CREATE POLICY "service_role_all_preventive_schedules"
  ON public.preventive_schedules FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS preventive_schedules_assoc_idx
  ON public.preventive_schedules (association_code) WHERE active;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'association_projects',
    label:       'Association capital projects',
    description: 'association_projects table — capital/large projects (roof, recert, repaint) with budget + % progress, behind the Association Hub Projects tab.',
    filename:    '20260608_projects_inspections.sql',
    artifact:    { type: 'table', table: 'association_projects' },
    sql: `CREATE TABLE IF NOT EXISTS public.association_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  name             text        NOT NULL,
  status           text        NOT NULL DEFAULT 'planning',
  vendor_name      text,
  budget           numeric,
  spent            numeric,
  target_date      date,
  pct_complete     integer     NOT NULL DEFAULT 0,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_proj_status CHECK (status IN ('planning','bidding','in_progress','on_hold','complete')),
  CONSTRAINT chk_proj_pct    CHECK (pct_complete BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS association_projects_assoc_idx
  ON public.association_projects (association_code) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_projects
  TO anon, authenticated, service_role;
ALTER TABLE public.association_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_projects" ON public.association_projects;
CREATE POLICY "service_role_all_association_projects"
  ON public.association_projects FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'association_inspections',
    label:       'Association inspections / certs',
    description: 'association_inspections table — compliance certifications (SB-4D milestone, reserve study, fire, elevator) with next-due dates, behind the Association Hub Inspections tab.',
    filename:    '20260608_projects_inspections.sql',
    artifact:    { type: 'table', table: 'association_inspections' },
    sql: `CREATE TABLE IF NOT EXISTS public.association_inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  inspection_type  text        NOT NULL,
  last_done        date,
  next_due         date,
  inspector        text,
  notes            text,
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS association_inspections_assoc_idx
  ON public.association_inspections (association_code) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_inspections
  TO anon, authenticated, service_role;
ALTER TABLE public.association_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_inspections" ON public.association_inspections;
CREATE POLICY "service_role_all_association_inspections"
  ON public.association_inspections FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'pmi_staff_setup_fields',
    label:       'Staff Setup profile fields',
    description: 'pmi_staff.alias + personal_phone + working_hours (per-weekday check-in/out + flexible lunch minutes as JSON) for the Staff Setup page.',
    filename:    '20260608_staff_setup.sql',
    artifact:    { type: 'column', table: 'pmi_staff', column: 'working_hours' },
    sql: `ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS alias          text,
  ADD COLUMN IF NOT EXISTS personal_phone text,
  ADD COLUMN IF NOT EXISTS working_hours  jsonb;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'staff_tasks',
    label:       'Staff tasks / reminders',
    description: 'staff_tasks table — recurring tasks per staffer (MAIA-created + manual; daily/weekly/monthly/yearly/on-expiry) behind the Staff Setup page; feeds the MAIA Daily News journal.',
    filename:    '20260608_staff_setup.sql',
    artifact:    { type: 'table', table: 'staff_tasks' },
    sql: `CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_email  text        NOT NULL,
  title           text        NOT NULL,
  source          text        NOT NULL DEFAULT 'manual',
  recurrence      text        NOT NULL DEFAULT 'once',
  next_due        date,
  expiry_date     date,
  notes           text,
  source_ref      text,
  active          boolean     NOT NULL DEFAULT true,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_staff_task_source CHECK (source     IN ('manual','maia')),
  CONSTRAINT chk_staff_task_recur  CHECK (recurrence IN ('once','daily','weekly','monthly','yearly','on_expiry'))
);
CREATE INDEX IF NOT EXISTS staff_tasks_assignee_idx
  ON public.staff_tasks (assignee_email) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS staff_tasks_source_ref_uniq
  ON public.staff_tasks (source_ref) WHERE source_ref IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_tasks
  TO anon, authenticated, service_role;
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_staff_tasks" ON public.staff_tasks;
CREATE POLICY "service_role_all_staff_tasks"
  ON public.staff_tasks FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'compliance_records',
    label:       'Compliance matrix records',
    description: 'compliance_records table — per-(association[, unit]) applicability + status for the Compliance matrix (association + owner/unit scopes). Catalog lives in lib/compliance-taxonomy.ts.',
    filename:    '20260608_compliance_records.sql',
    artifact:    { type: 'table', table: 'compliance_records' },
    sql: `CREATE TABLE IF NOT EXISTS public.compliance_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            text        NOT NULL DEFAULT 'association',
  association_code text        NOT NULL,
  unit_ref         text        NOT NULL DEFAULT '',
  item_key         text        NOT NULL,
  applicable       boolean     NOT NULL DEFAULT true,
  status           text        NOT NULL DEFAULT 'missing',
  expiry_date      date,
  notes            text,
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_compliance_scope  CHECK (scope  IN ('association','unit')),
  CONSTRAINT chk_compliance_status CHECK (status IN ('current','expiring','pending','missing','non_compliant','na'))
);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_records_uniq
  ON public.compliance_records (scope, association_code, unit_ref, item_key);
CREATE INDEX IF NOT EXISTS compliance_records_assoc_idx
  ON public.compliance_records (association_code, scope);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_records
  TO anon, authenticated, service_role;
ALTER TABLE public.compliance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_compliance_records" ON public.compliance_records;
CREATE POLICY "service_role_all_compliance_records"
  ON public.compliance_records FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'document_intake',
    label:       'MAIA Document Inbox',
    description: 'document_intake table (bulk upload → MAIA classifies → review/apply) + compliance_records.source_path linking an applied item to its source file.',
    filename:    '20260608_document_intake.sql',
    artifact:    { type: 'table', table: 'document_intake' },
    sql: `CREATE TABLE IF NOT EXISTS public.document_intake (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path              text        NOT NULL,
  filename                  text,
  mime_type                 text,
  status                    text        NOT NULL DEFAULT 'review',
  suggested_association_code text,
  suggested_category        text,
  suggested_item_key        text,
  doc_type                  text,
  effective_date            date,
  expiration_date           date,
  confidence                numeric,
  summary                   text,
  model                     text,
  applied_association_code  text,
  applied_item_key          text,
  applied_at                timestamptz,
  applied_by                text,
  uploaded_by               text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_doc_intake_status CHECK (status IN ('reading','review','applied','dismissed','error'))
);
CREATE INDEX IF NOT EXISTS document_intake_status_idx ON public.document_intake (status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_intake
  TO anon, authenticated, service_role;
ALTER TABLE public.document_intake ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_document_intake" ON public.document_intake;
CREATE POLICY "service_role_all_document_intake"
  ON public.document_intake FOR ALL TO service_role USING (true);
ALTER TABLE public.compliance_records
  ADD COLUMN IF NOT EXISTS source_path text;
NOTIFY pgrst, 'reload schema';`,
  },
  {
    key:         'estimate_requests',
    label:       'Vendor estimate requests (RFQ)',
    description: 'estimate_requests + estimate_request_vendors — request estimates from vendors on a work order (scope + photos), tokenized vendor accept/upload, MAIA follow-up.',
    filename:    '20260609_estimate_requests.sql',
    artifact:    { type: 'table', table: 'estimate_request_vendors' },
    sql: `CREATE TABLE IF NOT EXISTS public.estimate_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        bigint      NOT NULL,
  association_code text,
  scope            text        NOT NULL,
  photo_paths      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status           text        NOT NULL DEFAULT 'open',
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_estreq_status CHECK (status IN ('open','closed'))
);
CREATE INDEX IF NOT EXISTS estimate_requests_ticket_idx ON public.estimate_requests (ticket_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.estimate_request_vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid        NOT NULL REFERENCES public.estimate_requests(id) ON DELETE CASCADE,
  vendor_id        bigint,
  vendor_name      text,
  vendor_email     text        NOT NULL,
  status           text        NOT NULL DEFAULT 'sent',
  accepted_at      timestamptz,
  respond_by       date,
  estimate_path    text,
  submitted_at     timestamptz,
  last_followup_at timestamptz,
  followup_count   int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_estreqv_status CHECK (status IN ('sent','accepted','declined','submitted'))
);
CREATE INDEX IF NOT EXISTS estreqv_request_idx ON public.estimate_request_vendors (request_id);
CREATE INDEX IF NOT EXISTS estreqv_followup_idx ON public.estimate_request_vendors (status, created_at) WHERE status = 'sent';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_requests        TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_request_vendors TO anon, authenticated, service_role;
ALTER TABLE public.estimate_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_request_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_estimate_requests"        ON public.estimate_requests;
DROP POLICY IF EXISTS "service_role_all_estimate_request_vendors" ON public.estimate_request_vendors;
CREATE POLICY "service_role_all_estimate_requests"        ON public.estimate_requests        FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_estimate_request_vendors" ON public.estimate_request_vendors FOR ALL TO service_role USING (true);
NOTIFY pgrst, 'reload schema';`,
  },
]

// The one-time bootstrap function that the /admin/tools "Apply" button
// depends on. It must be pasted into the Supabase SQL editor by hand
// once — a function cannot install the function that installs functions.
// Kept in sync with supabase/migrations/20260520_exec_migration_function.sql.
export const EXEC_MIGRATION_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION public.exec_migration(sql text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

REVOKE ALL    ON FUNCTION public.exec_migration(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.exec_migration(text) TO service_role;`

/** True when the exec_migration helper is installed and callable by the
 *  service role. Probed by running a harmless no-op through it — a
 *  missing function comes back as a PostgREST "could not find the
 *  function" error; any other outcome means it exists. */
export async function execMigrationFunctionExists(): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc('exec_migration', { sql: 'SELECT 1' })
  if (!error) return true
  return !/could not find the function|function .* does not exist/i.test(error.message)
}

/** Look up a registered migration by its key. */
export function getMigrationByKey(key: string): MigrationEntry | undefined {
  return MIGRATIONS.find(m => m.key === key)
}

/** Probe every known migration's artifact in parallel. Each check
 *  runs a zero-row SELECT against the target table/column — Supabase
 *  returns an error if the artifact is missing, success otherwise.
 *  Cheap because LIMIT 0 doesn't scan rows. */
export async function checkMigrationStatus(): Promise<MigrationCheckResult[]> {
  const results = await Promise.all(
    MIGRATIONS.map(async (m): Promise<MigrationCheckResult> => {
      const applied = m.artifact.type === 'column'
        ? await columnExists(m.artifact.table, m.artifact.column)
        : await tableExists(m.artifact.table)
      return { ...m, applied }
    }),
  )
  return results
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from(table)
    .select(column)
    .limit(0)
  return !error
}

async function tableExists(table: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .limit(0)
  return !error
}
