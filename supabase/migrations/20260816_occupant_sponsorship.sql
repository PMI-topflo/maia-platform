-- =====================================================================
-- 20260816_occupant_sponsorship.sql
--
-- The sitting, already-approved TENANT sponsors an additional occupant:
-- confirms they are asking for the person to be added, supplies that person's
-- OWN email and phone, and acknowledges the responsibility the governing
-- documents already place on them for their occupants.
--
-- WHY THE OCCUPANT'S OWN EMAIL IS MANDATORY AND MUST DIFFER FROM THE TENANT'S
-- ---------------------------------------------------------------------------
-- MANXI 1003 is the case: the additional occupant's application carried the
-- TENANT's email address. MAIA uses email as identity — it is what the OTP
-- verifies and what an electronic signature is attributed to. Had that stood,
-- the occupant's affidavit and rules acknowledgment would have been sent to
-- the tenant's mailbox, verified against the tenant's mailbox, and recorded as
-- signed by the occupant. The board would then be relying on a signature that
-- only proves somebody with access to HER email signed it.
--
-- So the address is not merely requested — it is required, and it is rejected
-- if it matches the tenant's or anyone else already on the application.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.occupant_sponsorships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid        NOT NULL,
  association_code  text        NOT NULL,
  unit_label        text,
  token             text        NOT NULL,

  -- Who we asked: the approved tenant of record for the unit.
  tenant_name       text,
  tenant_email      text        NOT NULL,
  -- Who they are being asked about.
  occupant_name     text        NOT NULL,

  -- Their answer.
  responded_at      timestamptz,
  decision          text,                  -- requested | declined
  occupant_email    text,
  occupant_phone    text,
  acknowledged      boolean     NOT NULL DEFAULT false,
  note              text,

  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sponsorship_decision CHECK (decision IS NULL OR decision IN ('requested','declined'))
);
CREATE UNIQUE INDEX IF NOT EXISTS occupant_sponsorships_token ON public.occupant_sponsorships (token);
CREATE INDEX IF NOT EXISTS occupant_sponsorships_app ON public.occupant_sponsorships (application_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.occupant_sponsorships TO anon, authenticated, service_role;
ALTER TABLE public.occupant_sponsorships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_occupant_sponsorships" ON public.occupant_sponsorships;
CREATE POLICY "service_role_all_occupant_sponsorships" ON public.occupant_sponsorships FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
