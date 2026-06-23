-- =====================================================================
-- 20260623_maia_knowledge_kind.sql
--
-- "Teach MAIA" phase 2 — Behavior Rules. A taught item is now either:
--   • kind='knowledge' — a fact MAIA uses to answer (the original behavior)
--   • kind='behavior'  — a natural-language instruction for HOW MAIA should
--                        respond ("when a returning resident has more than
--                        one role, ask which one"). Injected into her prompt
--                        as a RULE, not as a fact.
--
-- Same scoping (association / persona / unit) and approve lifecycle apply.
-- Idempotent.
-- =====================================================================

ALTER TABLE public.maia_knowledge
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'knowledge';

NOTIFY pgrst, 'reload schema';
