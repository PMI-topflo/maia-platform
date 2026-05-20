-- =====================================================================
-- exec_migration(sql) — server-side migration runner
--
-- Powers the one-click "Apply" button in /admin/tools. The button POSTs
-- a migration KEY to /api/admin/migrations/apply, which looks the SQL up
-- from lib/migration-status.ts and runs it through this function via the
-- service role. Staff never send raw SQL.
--
-- SECURITY DEFINER so it runs with the owner's privileges and can
-- perform DDL. EXECUTE is REVOKED from PUBLIC and granted ONLY to
-- service_role, so it is unreachable from the browser-facing anon /
-- authenticated roles — it can only be invoked by the server.
--
-- This is the one migration that must be applied by hand: a function
-- cannot install the function that installs functions. Apply it once in
-- the Supabase SQL editor; every later migration can use the button.
--
-- Idempotent: CREATE OR REPLACE + re-runnable REVOKE/GRANT.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.exec_migration(sql text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

REVOKE ALL    ON FUNCTION public.exec_migration(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.exec_migration(text) TO service_role;

COMMENT ON FUNCTION public.exec_migration(text) IS
  'Runs migration SQL server-side for the /admin/tools Apply button. SECURITY DEFINER; execute granted only to service_role. The SQL is always sourced from the in-repo MIGRATIONS list, never from client input.';
