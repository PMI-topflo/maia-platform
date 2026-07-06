-- International applicants' supporting documents (foreign police clearance,
-- bank statements, bank reference letter, notarized translation) alongside
-- the plain domestic Checkr check every applicant already gets. See
-- lib/migration-status.ts for the full rationale.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS docs_intl_police_clearance_url text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS docs_intl_bank_statements_url text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS docs_intl_bank_reference_url text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS docs_intl_translation_url text;

NOTIFY pgrst, 'reload schema';
