-- =====================================================================
-- 20260618_association_vendor_links.sql
--
-- MAIA-local "this vendor serves this association" links. CINC's API
-- exposes the vendor↔association linkage READ-ONLY (GET vendorAssociation
-- / GET /vendor/{id}/accounts) — there is no write endpoint — and the
-- Vendor-Association Accounts are only set up for a handful of
-- associations. This table lets staff tag vendors to an association inside
-- MAIA so the Personas Vendors tab can scope properly everywhere, without
-- depending on CINC's sparse data.
--
-- One row per (association_code, cinc_vendor_id). Staff-only data — no
-- anon/authenticated grants. CREATE TABLE is instant; idempotent.
-- =====================================================================

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.association_vendor_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text NOT NULL,
  cinc_vendor_id   bigint NOT NULL,
  vendor_name      text,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS association_vendor_links_uniq
  ON public.association_vendor_links (association_code, cinc_vendor_id);
CREATE INDEX IF NOT EXISTS association_vendor_links_assoc_idx
  ON public.association_vendor_links (association_code);

-- ── Data-API exposure (REQUIRED — see _TEMPLATE_new_table.sql) ────────
-- Staff-only data, reached exclusively through the service-role admin
-- client. Deliberately NO anon / authenticated grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_vendor_links
  TO service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.association_vendor_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_association_vendor_links" ON public.association_vendor_links;
CREATE POLICY "service_role_all_association_vendor_links"
  ON public.association_vendor_links FOR ALL TO service_role USING (true);
