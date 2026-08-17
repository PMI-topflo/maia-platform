-- =====================================================================
-- 20260817_preferred_language.sql
--
-- The language each owner and tenant wants to hear from MAIA in.
--
-- MAIA already speaks six languages on the resident-facing side; what it has
-- never had is a record of which one any given person prefers, so every
-- outbound email has gone out in English and hoped. The annual unit survey
-- asks once, and every message after it can honour the answer.
--
-- Stored on the PERSON, not the unit: a unit does not have a language. An
-- owner in Quebec and their tenant in Lauderhill are two different answers
-- about the same unit, so owners and unit_tenant_contacts each get their own.
--
-- Nullable and unconstrained by design — 'unanswered' is a real state and
-- must not be confused with 'English'. Callers fall back to 'en' themselves.
-- Values are the PORTAL_LANGS set in lib/portal-i18n.ts
-- (en, es, pt, fr, ht, he, ru).
-- =====================================================================

ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS preferred_language text;

ALTER TABLE public.unit_tenant_contacts
  ADD COLUMN IF NOT EXISTS preferred_language text;

COMMENT ON COLUMN public.owners.preferred_language IS
  'Language this owner asked to be contacted in (PORTAL_LANGS). NULL = never asked; do not read as English.';
COMMENT ON COLUMN public.unit_tenant_contacts.preferred_language IS
  'Language this tenant asked to be contacted in (PORTAL_LANGS). NULL = never asked; do not read as English.';

NOTIFY pgrst, 'reload schema';
