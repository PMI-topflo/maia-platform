-- =====================================================================
-- _TEMPLATE_new_table.sql
--
-- DO NOT APPLY THIS FILE. The leading underscore breaks the Supabase
-- migration-naming convention (YYYYMMDD_*.sql) so this is never picked
-- up by any tooling. It exists solely as a copy-paste source.
--
-- Use this template when CREATING A NEW TABLE in `public`. Copy it to a
-- new file named `YYYYMMDD_<table_name>.sql`, fill in the blanks, and
-- register the migration in `lib/migration-status.ts`.
--
-- =====================================================================
-- ⚠ IMPORTANT: Supabase Data-API exposure (effective 2026-10-30)
-- =====================================================================
-- Until 2026-10-30, Supabase auto-grants SELECT/INSERT/UPDATE/DELETE on
-- every new public.* table to anon / authenticated / service_role.
-- Starting that date, the auto-grants stop. New tables created without
-- an explicit GRANT block will be INVISIBLE to supabase-js, PostgREST,
-- and GraphQL — even with RLS policies in place. The grant is the
-- access gate; RLS is the row filter on top of it.
--
-- Source: https://github.com/orgs/supabase/discussions/45329
--
-- The GRANT block below is mandatory for every new table going forward.
-- Existing tables (created before this date) keep their legacy grants
-- and don't need to be touched.
-- =====================================================================

-- =====================================================================
-- YYYYMMDD_<table_name>.sql
--
-- <Describe what this table holds, why it exists, and any subtle rules
--  (e.g. archive flags, idempotency keys, foreign-key cascade behavior).>
--
-- CREATE TABLE is instant; idempotent.
-- =====================================================================

-- ── Table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.your_table (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- <columns here>
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────
-- One per common access path. Add UNIQUE indexes for natural keys.
-- CREATE INDEX IF NOT EXISTS your_table_<col>_idx
--   ON public.your_table (<col>);

-- ── Data-API exposure (REQUIRED — see header note) ───────────────────
-- Broad grants match legacy default behavior so app code keeps working
-- exactly as it does for older tables. RLS below is where actual access
-- gets restricted. Narrow these GRANTs ONLY if you also intend to lock
-- the table to fewer roles (e.g. omit `anon` for staff-only tables).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table
  TO anon, authenticated, service_role;

-- If the table has a serial / bigserial column, sequences need USAGE too:
-- GRANT USAGE, SELECT ON SEQUENCE public.your_table_<col>_seq
--   TO anon, authenticated, service_role;

-- ── Row-level security ───────────────────────────────────────────────
ALTER TABLE public.your_table ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS by default in Supabase, but we add an
-- explicit FOR ALL policy so the intent is reviewable and the table
-- behaves the same way through every client (incl. PostgREST).
DROP POLICY IF EXISTS "service_role_all_your_table" ON public.your_table;
CREATE POLICY "service_role_all_your_table"
  ON public.your_table FOR ALL TO service_role USING (true);

-- Add narrower policies for anon / authenticated below as needed. Examples:
--
--   -- owners can read their own rows
--   CREATE POLICY "owners_select_your_table"
--     ON public.your_table FOR SELECT TO authenticated
--     USING ((auth.uid()) = user_id);
--
--   -- board members can read rows for their association
--   CREATE POLICY "board_select_your_table"
--     ON public.your_table FOR SELECT TO authenticated
--     USING (
--       association_code IN (
--         SELECT association_code FROM public.board_members
--         WHERE user_id = (auth.uid()) AND active
--       )
--     );
