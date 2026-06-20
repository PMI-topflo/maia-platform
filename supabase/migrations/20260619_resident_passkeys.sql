-- =====================================================================
-- 20260619_resident_passkeys.sql
--
-- Passkey (WebAuthn / Face ID / fingerprint) credentials for residents.
-- Layers on top of phone-OTP — a passkey login re-issues the same
-- maia_session cookie (lib/session.ts). Each row stores the WebAuthn
-- credential PLUS a snapshot of the resident's session identity, so a
-- discoverable passkey sign-in can rebuild the exact SessionData.
--
-- Staff-only data, reached via the service-role admin client. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.resident_passkeys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WebAuthn credential
  credential_id    text NOT NULL UNIQUE,        -- base64url credential ID
  public_key       text NOT NULL,               -- base64url COSE public key
  counter          bigint NOT NULL DEFAULT 0,   -- signature counter (clone detection)
  transports       text[],                      -- e.g. {internal,hybrid}
  aaguid           text,                        -- authenticator model id
  friendly_name    text,                        -- e.g. "iCloud Keychain"
  device_type      text,                        -- 'singleDevice' | 'multiDevice'
  backed_up        boolean,

  -- Identity snapshot to re-mint the maia_session (mirrors SessionData)
  subject_user_id  text NOT NULL,
  persona          text NOT NULL,
  association_code text NOT NULL,
  display_name     text,
  contact_name     text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz
);

-- List a resident's own passkeys (settings surface).
CREATE INDEX IF NOT EXISTS resident_passkeys_subject_idx
  ON public.resident_passkeys (persona, subject_user_id, association_code);

-- Staff-only data → service-role only. NO anon / authenticated grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resident_passkeys TO service_role;

ALTER TABLE public.resident_passkeys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_resident_passkeys" ON public.resident_passkeys;
CREATE POLICY "service_role_all_resident_passkeys"
  ON public.resident_passkeys FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
