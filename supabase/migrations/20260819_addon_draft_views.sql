-- =====================================================================
-- 20260819_addon_draft_views.sql
--
-- A drafted reply (application standard-reply, or the ticket AI draft) the
-- Gmail add-on generates as a server-rendered CardService card, which has no
-- native clipboard-write API — the only prior workaround was a multiline
-- TextInput staff had to tap into and select by hand, and that wasn't
-- discoverable enough. User direction, 2026-08-19 (asked twice): "there was
-- not COPY button to copy and paste the Draft text."
--
-- This table lets the add-on hand off to a REAL webpage — opened via
-- CardService's OpenLink, so it runs as normal browser JS with full
-- navigator.clipboard access — instead of trying to fake a copy affordance
-- inside the Card UI's restricted widget set. The id IS the access token
-- (an unguessable uuid), same security model as every other token-gated
-- page in this app (/request/[token], /esign/[token], etc): no login, no
-- expiry column, the token itself is the credential.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.addon_draft_views (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_text       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Data-API exposure (Supabase auto-grants stop 2026-10-30) ──────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addon_draft_views
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
-- service-role only: written by the addon-token-gated backend routes,
-- read by the public draft-view page — both go through supabaseAdmin,
-- never the anon client directly (same pattern as document_requests).
ALTER TABLE public.addon_draft_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_addon_draft_views" ON public.addon_draft_views;
CREATE POLICY "service_role_all_addon_draft_views"
  ON public.addon_draft_views FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
