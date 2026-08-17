-- =====================================================================
-- 20260816_car_registration_label.sql
--
-- "Updated Vehicle Information" → "Car Registration" (user direction,
-- 2026-08-16).
--
-- The label promised a FORM — some sheet on which a renewing tenant writes
-- down their current vehicle. No such form exists, and none is planned: the
-- doc_key has always been `car_registration`, and what is actually collected
-- is the registration document itself. Every other association and
-- application type already said so; only MANXI's lease_renewal row carried
-- the "Updated Vehicle Information" wording, which is how it came to be read
-- as a form to fill in rather than a document to send.
--
-- Scoped to rows whose label is still the old one, so a label edited by hand
-- in Association document setup is never overwritten. Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET label = 'Car Registration', updated_at = now()
 WHERE doc_key = 'car_registration'
   AND label = 'Updated Vehicle Information';

NOTIFY pgrst, 'reload schema';
