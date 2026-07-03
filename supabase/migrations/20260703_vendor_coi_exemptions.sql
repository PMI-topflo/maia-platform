-- =====================================================================
-- 20260703_vendor_coi_exemptions.sql
--
-- Staff can mark a vendor exempt from the invoice-push COI guard
-- (app/api/admin/invoices/intake/[id]/push/route.ts) — e.g. an attorney,
-- appraiser, or credit-reporting agency that legitimately never carries
-- general-liability insurance. This table is the actual source of truth
-- for that gate, NOT CINC's own vendor-insurance isRequired flag: CINC's
-- flag defaults to false for every vendor and isn't maintained by
-- anyone, so "false" there can't be trusted to mean "deliberately
-- exempt" — only a row in THIS table, written by an explicit staff
-- action, can. When staff sets an exemption here, the same value is
-- ALSO mirrored into CINC's isRequired flag (setVendorInsuranceRequired)
-- so CINC's own record stays accurate for anyone looking at it there —
-- but the guard itself only ever reads this table.
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.vendor_coi_exemptions (
  cinc_vendor_id   integer PRIMARY KEY,
  vendor_name      text,
  exempt           boolean     NOT NULL DEFAULT true,
  reason           text,
  set_by_email     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_coi_exemptions
  TO anon, authenticated, service_role;

ALTER TABLE public.vendor_coi_exemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_vendor_coi_exemptions" ON public.vendor_coi_exemptions;
CREATE POLICY "service_role_all_vendor_coi_exemptions"
  ON public.vendor_coi_exemptions FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
