-- Per-association custom unit-level compliance requirements, e.g. the City
-- of Lauderhill's Certificate of Use (Manors XI only) or Del Vista's Lease
-- Addendum. Merges into the fixed compliance-taxonomy required-items list
-- for that association only. Idempotent.

CREATE TABLE IF NOT EXISTS public.association_document_requirements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  item_key         text        NOT NULL,   -- e.g. 'unit.custom_cou', 'unit.custom_lease_addendum'
  label            text        NOT NULL,
  occupancy_filter text,                    -- owner_occupied | leased | vacant | NULL (always required)
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_assoc_doc_req_occ CHECK (occupancy_filter IS NULL OR occupancy_filter IN ('owner_occupied','leased','vacant'))
);
CREATE UNIQUE INDEX IF NOT EXISTS association_document_requirements_uniq ON public.association_document_requirements (association_code, item_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_document_requirements TO anon, authenticated, service_role;
ALTER TABLE public.association_document_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_document_requirements" ON public.association_document_requirements;
CREATE POLICY "service_role_all_association_document_requirements" ON public.association_document_requirements FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
