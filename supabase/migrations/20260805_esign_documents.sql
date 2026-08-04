-- =====================================================================
-- 20260805_esign_documents.sql
--
-- Shared "association e-sign forms" engine. One generic table backs every
-- signable association form (pet registration, board decision page, future
-- forms) so they reuse ONE verified-signature flow, ONE token scheme, ONE
-- signing page, and ONE PDF verification certificate — instead of a bespoke
-- table per form (the lease_packets pattern, generalized).
--
--   kind      → the form-registry key (lib/esign-forms) that knows how to
--               render + validate this document.
--   payload   → the form's field values (shape is per-kind).
--   signers   → array of { role, name, email, phone, signed_at, sig_name,
--               sig_image, sig_ip, verification } — N signers per form
--               (pet reg = 1 applicant; a lease-style form = 2).
--
-- The existing lease_packets flow is left as-is (proven, legally in use);
-- new forms use this engine. CREATE TABLE is instant + idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.esign_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text        NOT NULL,               -- form-registry key
  association_code  text        NOT NULL,
  unit_ref          text,                               -- CINC account_number, when unit-scoped
  title             text,
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  signers           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status            text        NOT NULL DEFAULT 'sent', -- draft | sent | partially_signed | completed | void
  compliance_item   text,                               -- optional: compliance_records item_key to file on completion
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_esign_status CHECK (status IN ('draft','sent','partially_signed','completed','void'))
);

CREATE INDEX IF NOT EXISTS esign_documents_assoc_idx
  ON public.esign_documents (association_code, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS esign_documents_unit_idx
  ON public.esign_documents (association_code, unit_ref);

-- Mandatory explicit grants for new public tables (Supabase auto-grants stop 2026-10-30).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esign_documents TO anon, authenticated, service_role;
ALTER TABLE public.esign_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_esign_documents" ON public.esign_documents;
CREATE POLICY "service_role_all_esign_documents" ON public.esign_documents FOR ALL TO service_role USING (true);

NOTIFY pgrst, 'reload schema';
