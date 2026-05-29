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
                               ('pending_review','needs_vendor','duplicate_in_cinc',
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
