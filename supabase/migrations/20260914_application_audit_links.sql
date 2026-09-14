-- =====================================================================
-- 20260914_application_audit_links.sql
--
-- Share links for an application's "Processing audit" card (created /
-- last file / requests sent / approval speed / still missing / sent to
-- board). Staff create one from the application page and email it to a
-- realtor, applicant or board member who says "you are taking too long";
-- the link opens a public, read-only timeline card (no login, like
-- /request/[token]). The id IS the token. Revoke by setting revoked_at.
-- User direction, 2026-09-14. CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.application_audit_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  view_count       integer NOT NULL DEFAULT 0,
  last_viewed_at   timestamptz,
  revoked_at       timestamptz
);

CREATE INDEX IF NOT EXISTS application_audit_links_application_idx
  ON public.application_audit_links (application_id);

-- ── Data-API exposure (REQUIRED — see _TEMPLATE_new_table.sql) ──────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_audit_links
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.application_audit_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_application_audit_links" ON public.application_audit_links;
CREATE POLICY "service_role_all_application_audit_links"
  ON public.application_audit_links FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
