-- =====================================================================
-- 20260620_resident_language_prefs.sql
--
-- A resident's preferred UI language, set from their profile page. Keyed by
-- (persona, persona_record_id) — the same key the profile-edit flow uses
-- (lib/profile-change.ts). Read by the resident portal to pick the default
-- language; the ?lang= URL param still overrides it.
--
-- Staff-only data, reached via the service-role admin client. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.resident_language_prefs (
  persona            text NOT NULL,
  persona_record_id  text NOT NULL,
  lang               text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (persona, persona_record_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident_language_prefs TO service_role;

ALTER TABLE public.resident_language_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_resident_language_prefs" ON public.resident_language_prefs;
CREATE POLICY "service_role_all_resident_language_prefs"
  ON public.resident_language_prefs FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
