-- =====================================================================
-- 20260817_vpci_signage_rental_rules.sql
--
-- Three rules for Venetian Park Condominium I (VPCI), from the board
-- (user direction, 2026-08-17).
--
-- Written as RULES, not as the questions they arrived as. The `label` is
-- applicant-facing — /api/pre-apply/[token] serves it straight to the person
-- filling in the application — so "Am I allowed to place a For Sale sign?"
-- becomes the prohibition itself. An applicant reading a checklist needs to be
-- told what the rule is, not asked what they are wondering.
--
-- ALL THREE ARE 'warn', NOT 'block'. Per this table's own convention, 'block'
-- means mechanically enforced in /apply — the server can refuse the
-- application on it. None of these can be:
--   · a sign is placed after move-in, and nothing in an application predicts it;
--   · short-term letting is a future act, and the 90-day minimum lease term
--     (min_lease_days, already on file) is what actually stops it at intake;
--   · the 20% cap needs a live count of rented units, and occupancy data is
--     not complete enough to refuse somebody on.
-- So they are surfaced to the applicant and flagged for the board, which is
-- honest, rather than pretending to an enforcement that is not there.
--
-- NOT ADDED: "must own two years prior to rental". VPCI already carries it as
-- no_rent_years_after_purchase = 2 (seeded 2026-07-05). A second row saying
-- the same thing is how two rules start to disagree.
--
-- Idempotent: ON CONFLICT DO UPDATE, so re-running after editing a value
-- never duplicates a row.
-- =====================================================================

INSERT INTO public.association_application_rules
  (association_code, rule_key, value, label, enforcement, created_by)
VALUES
  ('VPCI', 'no_for_sale_sign', 'true'::jsonb,
   'No "For Sale" sign may be displayed on the unit, in its windows, or anywhere on the Association''s property.',
   'warn', 'maia_seed_20260817'),

  ('VPCI', 'no_short_term_rental', 'true'::jsonb,
   'Short-term rentals are not permitted. The unit may not be advertised or let through Airbnb, Vrbo or any similar short-term platform. The Association''s 90-day minimum lease term applies to every tenancy.',
   'warn', 'maia_seed_20260817'),

  ('VPCI', 'max_rented_pct', '20'::jsonb,
   'No more than 20% of the units may be leased at any one time. Once that cap is reached, no further lease is approved until a unit comes out of rental.',
   'warn', 'maia_seed_20260817')

ON CONFLICT (association_code, rule_key) DO UPDATE
  SET value = EXCLUDED.value, label = EXCLUDED.label,
      enforcement = EXCLUDED.enforcement, active = true, updated_at = now();

NOTIFY pgrst, 'reload schema';
