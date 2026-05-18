-- =====================================================================
-- association_documents.language
--
-- Per-document language code so staff can upload a Spanish-language
-- Rules PDF alongside the English one (same association, same
-- category, different language). The apply form will offer the
-- applicant a language picker when more than one version exists for
-- a given category.
--
-- Defaults to 'en' so existing rows (uploaded before this column
-- existed) are treated as English — that matches reality since the
-- legal docs uploaded so far have been English.
--
-- Allowed codes mirror the apply-form translation set (en/es/pt/fr/
-- he/ru) but the column is text rather than enum so adding a new
-- language later doesn't require a migration.
-- =====================================================================

ALTER TABLE public.association_documents
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

-- Helps the apply endpoint pick the right doc fast: "give me the
-- newest active row for (association_code, category, language)".
-- Predicate keeps the index small — most rows are NOT archived.
CREATE INDEX IF NOT EXISTS adocs_active_per_cat_lang_idx
  ON public.association_documents (association_code, category, language, created_at DESC)
  WHERE archived_at IS NULL;
