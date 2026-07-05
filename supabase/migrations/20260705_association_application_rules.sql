-- Per-association application eligibility rules (individuals-only, minimum
-- lease term, rental-frequency caps, post-purchase hold periods, etc). Text
-- rule_key (not an enum) so adding a brand-new rule type for a brand-new
-- association is always just another row -- never a migration, and never
-- touches any other association's existing rows. Mirrors the
-- association_document_requirements pattern already in place.

CREATE TABLE IF NOT EXISTS public.association_application_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  association_code text        NOT NULL,
  rule_key         text        NOT NULL,   -- e.g. 'individuals_only', 'min_lease_days', 'max_rentals_per_12mo', 'no_rent_years_after_purchase'
  value            jsonb       NOT NULL,   -- boolean / number / string depending on rule_key
  label            text        NOT NULL,   -- human-readable description for the admin UI + applicant-facing copy
  -- 'block' rules are mechanically enforced in /apply (client hides/blocks + server hard-validates).
  -- 'warn' rules can't be reliably auto-enforced yet (e.g. depend on data that isn't populated for
  -- most units, like owners.ownership_start_date) -- they're surfaced as a flag for staff/board to
  -- manually verify at review time instead of blocking the applicant outright.
  enforcement      text        NOT NULL DEFAULT 'warn',
  active           boolean     NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_assoc_app_rules_enforcement CHECK (enforcement IN ('block','warn'))
);
CREATE UNIQUE INDEX IF NOT EXISTS association_application_rules_uniq ON public.association_application_rules (association_code, rule_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.association_application_rules TO anon, authenticated, service_role;
ALTER TABLE public.association_application_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_association_application_rules" ON public.association_application_rules;
CREATE POLICY "service_role_all_association_application_rules" ON public.association_application_rules FOR ALL TO service_role USING (true);
DROP POLICY IF EXISTS "public_read_association_application_rules" ON public.association_application_rules;
CREATE POLICY "public_read_association_application_rules" ON public.association_application_rules FOR SELECT TO anon, authenticated USING (active = true);

-- Seed VPCI's 4 rules extracted from its Declaration + Rules and Regulations
-- (2026-07-05). ON CONFLICT DO UPDATE so re-running this file after editing
-- a value is safe and never duplicates rows.
INSERT INTO public.association_application_rules (association_code, rule_key, value, label, enforcement, created_by)
VALUES
  ('VPCI', 'individuals_only', 'true'::jsonb, 'Individuals only -- no LLC/corporate purchasers (effective 10/13/21)', 'block', 'maia_seed'),
  ('VPCI', 'min_lease_days', '90'::jsonb, 'Minimum lease term is 90 days', 'warn', 'maia_seed'),
  ('VPCI', 'max_rentals_per_12mo', '1'::jsonb, 'A unit may be rented at most once every 12 months', 'warn', 'maia_seed'),
  ('VPCI', 'no_rent_years_after_purchase', '2'::jsonb, 'An owner may not rent out the unit for the first 2 years after purchase', 'warn', 'maia_seed')
ON CONFLICT (association_code, rule_key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label, enforcement = EXCLUDED.enforcement, updated_at = now();

NOTIFY pgrst, 'reload schema';
