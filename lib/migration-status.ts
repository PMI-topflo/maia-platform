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
