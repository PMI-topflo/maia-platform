-- =====================================================================
-- 20260801_lease_packets.sql
--
-- The per-unit "lease packet" e-signature flow. When a unit is leased,
-- staff send the Landlord & Tenant Acknowledgment/Certification/E-Sign
-- Consent Agreement to the owner AND the tenant; each opens a login-free
-- link and signs in MAIA. One row per packet tracks both signatures +
-- evidence (typed name, drawn signature PNG, IP, timestamp). When both
-- roles have signed, the packet is "completed" and the signed PDF is
-- generated on demand from this immutable row + filed against the unit's
-- unit.landlord_tenant_agreement compliance item.
--
-- Association-agnostic: association_legal_name is snapshotted here so the
-- same flow works for every association just by swapping the name (from
-- associations.legal_name). MANXI first, extensible to all.
--
-- Also: associations.legal_name — the full legal entity name the two
-- statutory documents embed (e.g. "The Manors of Inverrary XI
-- Condominium Association, Inc.").
--
-- CREATE TABLE / ADD COLUMN are instant; idempotent.
-- =====================================================================

-- ── associations.legal_name ──────────────────────────────────────────
ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS legal_name text;

-- Seed Manors XI's full legal name (the source docs use this verbatim).
UPDATE public.associations
   SET legal_name = 'The Manors of Inverrary XI Condominium Association, Inc.'
 WHERE association_code = 'MANXI' AND (legal_name IS NULL OR legal_name = '');

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lease_packets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code       text        NOT NULL,
  unit_ref               text        NOT NULL,          -- CINC account_number
  unit_number            text,
  association_legal_name text,                           -- snapshot at send
  owner_name             text,
  owner_email            text,
  tenant_name            text,
  tenant_email           text,
  lease_start            date,
  lease_end              date,
  effective_date         date,
  status                 text        NOT NULL DEFAULT 'sent',  -- sent | partially_signed | completed | void
  owner_signed_at        timestamptz,
  owner_sig_name         text,
  owner_sig_image        text,                           -- PNG data URL
  owner_sig_ip           text,
  tenant_signed_at       timestamptz,
  tenant_sig_name        text,
  tenant_sig_image       text,
  tenant_sig_ip          text,
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_lease_packet_status CHECK (status IN ('sent','partially_signed','completed','void'))
);

-- Common access path: the unit's packets, newest first.
CREATE INDEX IF NOT EXISTS lease_packets_unit_idx
  ON public.lease_packets (association_code, unit_ref, created_at DESC);

-- ── Data-API exposure (REQUIRED — Supabase drops auto-grants 2026-10-30) ─
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lease_packets
  TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.lease_packets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_lease_packets" ON public.lease_packets;
CREATE POLICY "service_role_all_lease_packets"
  ON public.lease_packets FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
