-- =====================================================================
-- sms_consents — proof of A2P 10DLC opt-in
--
-- TCR requires evidence that every user who receives SMS from us has
-- explicitly opted in. Recorded when the user checks the consent box
-- on the login / OTP-request flow in components/TwoFactorAuth.tsx.
--
-- Stored as an append-only ledger: never updated, never deleted by
-- application code. If a user opts back in later, a new row is added.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.sms_consents (
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
  ON public.sms_consents FOR ALL TO service_role USING (true);
