-- =====================================================================
-- 20260601_association_match_aliases.sql
-- Add a curated list of common-name aliases per association so MAIA can
-- map a document/email to the right association even when it only carries
-- the common name ("One Bay Harbor"), not the code or full legal name.
--
-- Used by detectAssociationCode (lib/maia-command-processor.ts) as a
-- high-confidence signal, alongside the explicit "#CODE" tag and the
-- account-number pattern. Existing table — no GRANT changes needed.
-- Idempotent. Seed the values via APPLY_association_aliases_seed.sql.
-- =====================================================================

alter table public.associations
  add column if not exists match_aliases text[] not null default '{}';

NOTIFY pgrst, 'reload schema';
