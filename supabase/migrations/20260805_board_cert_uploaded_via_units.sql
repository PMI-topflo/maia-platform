-- =====================================================================
-- 20260805_board_cert_uploaded_via_units.sql
--
-- Allow board-education certificates to be uploaded from the /units audit
-- by on-site managers / board members (uploaded_via = 'units'), in addition
-- to the existing 'staff' (admin hub) and 'self' (emailed link) paths.
--
-- Idempotent: drops whatever CHECK currently constrains uploaded_via
-- (its auto-generated name may vary) and re-adds the widened one.
-- =====================================================================

DO $$
DECLARE cn text;
BEGIN
  FOR cn IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.board_member_certifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%uploaded_via%'
  LOOP
    EXECUTE format('ALTER TABLE public.board_member_certifications DROP CONSTRAINT %I', cn);
  END LOOP;
  ALTER TABLE public.board_member_certifications
    ADD CONSTRAINT board_member_certifications_uploaded_via_check
    CHECK (uploaded_via IN ('staff','self','units'));
END $$;

NOTIFY pgrst, 'reload schema';
