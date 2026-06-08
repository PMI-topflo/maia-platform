-- =====================================================================
-- 20260608_compliance_records.sql
--
-- Per-(association[, unit]) compliance state for the Compliance matrix.
-- The master catalog lives in code (lib/compliance-taxonomy.ts); this
-- table stores only what's been set: whether an item APPLIES + its STATUS
-- (+ expiry). One row per (scope, association, unit_ref, item_key).
-- unit_ref = '' for association scope (so the unique key works cleanly).
-- Idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.compliance_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            text        NOT NULL DEFAULT 'association',
  association_code text        NOT NULL,
  unit_ref         text        NOT NULL DEFAULT '',
  item_key         text        NOT NULL,
  applicable       boolean     NOT NULL DEFAULT true,
  status           text        NOT NULL DEFAULT 'missing',
  expiry_date      date,
  notes            text,
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_compliance_scope  CHECK (scope  IN ('association','unit')),
  CONSTRAINT chk_compliance_status CHECK (status IN ('current','expiring','pending','missing','non_compliant','na'))
);
CREATE UNIQUE INDEX IF NOT EXISTS compliance_records_uniq
  ON public.compliance_records (scope, association_code, unit_ref, item_key);
CREATE INDEX IF NOT EXISTS compliance_records_assoc_idx
  ON public.compliance_records (association_code, scope);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_records
  TO anon, authenticated, service_role;
ALTER TABLE public.compliance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_compliance_records" ON public.compliance_records;
CREATE POLICY "service_role_all_compliance_records"
  ON public.compliance_records FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
