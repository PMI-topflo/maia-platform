-- =====================================================================
-- Dialpad ingest: webhook-driven SMS + call events into
-- general_conversations, plus the mapping tables that let us correlate
-- a Dialpad user/number back to the right pmi_staff row.
--
-- See: app/api/dialpad/webhook/route.ts (event sink),
--      app/api/admin/dialpad/*       (setup + sync + backfill),
--      lib/dialpad.ts, lib/dialpad-ingest.ts.
-- =====================================================================

-- staff_dialpad_lines: which Dialpad users belong to which pmi_staff
CREATE TABLE IF NOT EXISTS public.staff_dialpad_lines (
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

-- dialpad_numbers: company phone numbers
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

-- dialpad_webhook_config: singleton id=1 with webhook + subscription IDs
-- and the JWT-signing secret Dialpad uses on its inbound events.
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

-- Dedupe column on general_conversations so the same Dialpad event
-- arriving twice (provider retry, replay during backfill) only writes
-- one row. Format is `dialpad_sms_${id}` / `dialpad_call_${call_id}`.
ALTER TABLE public.general_conversations ADD COLUMN IF NOT EXISTS external_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gc_external_id
  ON public.general_conversations (external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.staff_dialpad_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialpad_numbers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialpad_webhook_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_sdl" ON public.staff_dialpad_lines;
DROP POLICY IF EXISTS "service_role_all_dn"  ON public.dialpad_numbers;
DROP POLICY IF EXISTS "service_role_all_dwc" ON public.dialpad_webhook_config;
CREATE POLICY "service_role_all_sdl" ON public.staff_dialpad_lines    FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_dn"  ON public.dialpad_numbers        FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_dwc" ON public.dialpad_webhook_config FOR ALL TO service_role USING (true);
