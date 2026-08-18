-- =====================================================================
-- 20260818_unit_pets.sql
--
-- Pet Registration was structured data trapped inside a PDF. The signed form
-- (esign_documents.payload) is the legal record, and stays; but the actual
-- content — what animal, what breed, is the rabies shot current — lived
-- ONLY inside that one document's JSONB blob. Nothing else in MAIA could ask
-- "which units at MANXI have a dog" or "whose vaccination record expires next
-- month" without opening every signed PDF by hand. That is what the user
-- meant by "actual fields, not a simple PDF" — the data has to exist as rows
-- the rest of the system can query, the same way lib/esign.ts already writes
-- an emergency-contact-list signing into unit_occupancy and
-- unit_tenant_contacts, not just into the signed document.
--
-- One row per animal (a unit can have more than one). Superseded, never
-- overwritten in place: a fresh registration marks the unit's prior active
-- rows inactive and inserts the new set — the old rows stay on file as a
-- record of what was previously registered, same convention as every other
-- "supersede, don't destroy" table this month.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.unit_pets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code   text        NOT NULL,
  unit_ref           text        NOT NULL,
  -- The signed document this came from — the source of truth if a field is
  -- ever in question. Nullable: a unit's pet record may need hand correction
  -- by staff with no document behind that specific edit.
  esign_document_id  uuid,
  -- 'pet' | 'service' | 'esa' | 'unsure' — which branch of the animal
  -- questionnaire this came from. A service animal or ESA is never subject to
  -- the association's ordinary pet rules, fees or limits — this is how a
  -- report can tell the two apart without re-reading the PDF.
  kind               text        NOT NULL DEFAULT 'pet',
  animal_type        text,       -- e.g. "Dog", "Cat"
  name               text,
  breed              text,
  color              text,
  weight             text,
  age                text,
  sex                text,
  altered            boolean,
  license_number     text,
  rabies_date        date,
  -- Vaccination record path is what the renewal-alert cron reads to know
  -- when a fresh one is needed — expiry is ALWAYS 1 year from rabies_date
  -- (see petRegistrationExpiry in lib/esign-forms.tsx), computed on read
  -- rather than stored twice.
  vaccination_doc_path text,
  photo_path         text,
  active             boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_unit_pets_kind CHECK (kind IN ('pet','service','esa','unsure'))
);
CREATE INDEX IF NOT EXISTS unit_pets_unit ON public.unit_pets (association_code, unit_ref) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_pets TO anon, authenticated, service_role;
ALTER TABLE public.unit_pets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_unit_pets" ON public.unit_pets;
CREATE POLICY "service_role_all_unit_pets" ON public.unit_pets FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
