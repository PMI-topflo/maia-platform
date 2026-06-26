-- =====================================================================
-- 20260625_sticker_flow_tables.sql
--
-- Parking-sticker self-service flow (SMS/WhatsApp/voice — menu option 1).
-- The assistant collects a vehicle and opens a sticker request:
--   createStickerRequest() in app/api/webhook/route.ts
--   getStickerStatus()    in app/api/webhook/route.ts
--
-- Both tables were missing from the live DB (PostgREST PGRST205) — part of a
-- family of early resident-flow tables that never landed on this Supabase
-- project — so the sticker flow could not persist anything. This restores
-- them. vehicles is the FK target of sticker_requests, so they ship together.
--
-- owner_id is the contact's phone string (how the webhook keys residents),
-- not a uuid. Reached only via the service-role admin client → service_role
-- grant is sufficient. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vehicles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   text        NOT NULL,
  make       text,
  model      text,
  color      text,
  plate      text,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, plate)          -- upsert onConflict target
);

CREATE TABLE IF NOT EXISTS public.sticker_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         text        NOT NULL,
  vehicle_id       uuid        REFERENCES public.vehicles (id) ON DELETE SET NULL,
  association_id   text,
  request_source   text,
  status           text        NOT NULL DEFAULT 'pending',
  payment_status   text        NOT NULL DEFAULT 'unpaid',
  payment_required boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Status lookup is "latest request for this owner" (getStickerStatus).
CREATE INDEX IF NOT EXISTS sticker_requests_owner_created_idx
  ON public.sticker_requests (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vehicles_owner_idx
  ON public.vehicles (owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sticker_requests TO service_role;

NOTIFY pgrst, 'reload schema';
