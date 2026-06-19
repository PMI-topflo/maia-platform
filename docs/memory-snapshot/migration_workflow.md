---
name: supabase-migration-workflow-pain-point-rules
description: "How DB migrations get applied on the MAIA platform, why they keep going wrong, and the rules to prevent it"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0363c6fe-ab6d-4432-a13b-88c075f3d964
---

## The problem
The user (Fabio, non-developer) applies every migration **by hand** — copy-pasting SQL into the Supabase SQL editor. This has gone wrong repeatedly:
- Re-running a non-idempotent migration → `42710: policy already exists`
- Pasting a file PATH instead of its contents → `42601: syntax error near "supabase"`
- Pasting an email address / wrong text into the SQL box → syntax error
- Forgetting to apply a migration at all → code references a missing column → page silently shows 0 rows

The user has explicitly called migrations "a nightmare." Treat this as a known sharp edge.

## Rules for writing migrations (always follow)
1. **Every migration MUST be fully idempotent / re-runnable.**
   - Tables: `CREATE TABLE IF NOT EXISTS`
   - Columns: `ADD COLUMN IF NOT EXISTS`
   - Indexes: `CREATE INDEX IF NOT EXISTS`
   - Policies: `DROP POLICY IF EXISTS ...;` immediately before every `CREATE POLICY`
   - Seed rows: `INSERT ... ON CONFLICT DO NOTHING`
2. **When handing SQL to the user, paste the literal SQL text** in the message — never a file path. They run it in the Supabase SQL editor.
3. **Register every new migration in `lib/migration-status.ts`** so the `/admin/tools` schema-migrations panel shows whether it's applied.
4. Keep code **migration-tolerant**: probe for a column/table before SELECTing it; degrade gracefully if absent.
5. **New `public` tables need an explicit GRANT** (Supabase change — auto-grant for new tables ends 2026-10-30 for existing projects). Use [supabase/migrations/_TEMPLATE_new_table.sql](../../../Documents/GitHub/maia-platform/supabase/migrations/_TEMPLATE_new_table.sql) as the canonical copy-paste source. It includes the required GRANT block, RLS enable, and service_role policy.
   - **Default pattern** (matches legacy behavior — what every existing table already has):
     ```sql
     GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table
       TO anon, authenticated, service_role;
     ```
     Broad grants match the legacy auto-grant default. RLS policies are the actual access gate. This keeps new tables behaviorally identical to the 70+ existing tables.
   - **Narrow only when intentionally locking** — e.g. staff-only admin tables can drop `anon` from the GRANT list. But narrowing for "stricter security" while keeping RLS is mostly cosmetic since RLS is the real gate.
   - **Sequences (bigserial/serial columns)** need their own GRANT: `GRANT USAGE, SELECT ON SEQUENCE public.your_table_<col>_seq TO anon, authenticated, service_role;`
   - **RLS `CREATE POLICY` is NOT a substitute for the table-level GRANT** — without the GRANT, the role hits permission-denied before RLS even runs.
   - Existing tables keep their grants — no backfill needed; this is forward-looking only.
   - Source: https://github.com/orgs/supabase/discussions/45329

## One-click "Apply" button — BUILT (PR #124, 2026-05-20)
The `/admin/tools` schema-migrations panel now has an **Apply** button per unapplied migration. It POSTs the migration KEY to `/api/admin/migrations/apply`, which resolves the SQL from the `MIGRATIONS` list and runs it server-side via the `exec_migration(sql)` SECURITY DEFINER Postgres function.
- ONE-TIME bootstrap: `exec_migration` itself must be applied by hand once (`supabase/migrations/20260520_exec_migration_function.sql`) — a function can't install itself. The panel shows a setup card with the SQL until then.
- After bootstrap, every migration registered in `lib/migration-status.ts` applies with one click. The rules above (idempotent SQL, register in migration-status.ts) still matter — the button only runs registered migrations.
