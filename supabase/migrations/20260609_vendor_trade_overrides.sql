-- =====================================================================
-- 20260609_vendor_trade_overrides.sql
--
-- Per-vendor trade/type override. CINC's vendor-type list is read-only
-- (no create-type endpoint), so:
--   • assigning an EXISTING CINC type → pushed to CINC (VendorTypeID) AND
--     mirrored here (source='cinc') so the UI updates immediately;
--   • a trade CINC lacks (e.g. ROOFER) → stored here only (source='local')
--     for MAIA filtering / RFQ, flagged "not in CINC".
-- Keyed by CINC VendorId. Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vendor_trade_overrides (
  vendor_id    bigint      PRIMARY KEY,
  trade        text        NOT NULL,
  cinc_type_id text,
  source       text        NOT NULL DEFAULT 'local',
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vto_source CHECK (source IN ('cinc','local'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_trade_overrides
  TO anon, authenticated, service_role;
ALTER TABLE public.vendor_trade_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_vendor_trade_overrides" ON public.vendor_trade_overrides;
CREATE POLICY "service_role_all_vendor_trade_overrides"
  ON public.vendor_trade_overrides FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
