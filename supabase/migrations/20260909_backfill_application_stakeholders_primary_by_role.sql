-- =====================================================================
-- 20260909_backfill_application_stakeholders_primary_by_role.sql
--
-- User report, 2026-09-09 (Ashlee Elizabeth Muthra, MANXI Unit 702): the
-- admin dashboard header showed "Applicant: not set" even though she was
-- the only, clearly-filled-in applicant in the Applicants card below.
--
-- Root cause: every "who is the primary applicant" read in this codebase
-- (14 call sites, e.g. app/api/admin/pre-apply/[id]/route.ts's header,
-- lib/application-payment-link.ts's sendApplicationPaymentLink, the
-- board-approval handoff) filters .eq('role','applicant').eq('is_primary',
-- true) -- is_primary is scoped PER ROLE by design, not a single
-- whole-application flag. But lib/preapply.ts's addStakeholders() (used
-- whenever someone is added to an application already in progress -- an
-- agent adding the real applicant, mid-intake collaborators, etc.)
-- unconditionally inserted every new person with is_primary: false,
-- regardless of whether their role already had a primary. When an agent
-- starts the intake (createIntake sets is_primary=true on the AGENT's own
-- row, role='applicant_agent'/'listing_agent'), the real applicant added
-- afterward never became primary -- no role='applicant' row was ever
-- primary, so every one of those 14 reads found nobody. Fixed at the
-- source in the same change (addStakeholders now marks a new person
-- primary within their own role, but only if that role doesn't already
-- have one): this is the one-time catch-up for applications already
-- affected.
--
-- For every (application_id, role) pair with at least one stakeholder but
-- NO row already is_primary=true, mark the earliest-created row of that
-- role primary (row_number()+bool_or() rather than a MIN(created_at) self
-- join, so two rows inserted in the same statement with an identical
-- timestamp can't both match). Idempotent: a (application_id, role) pair
-- that already has a primary is left untouched, so a second run is a no-op.
-- =====================================================================

WITH ranked AS (
  SELECT id, application_id, role,
         row_number() OVER (PARTITION BY application_id, role ORDER BY created_at ASC, id ASC) AS rn,
         bool_or(is_primary) OVER (PARTITION BY application_id, role) AS role_has_primary
  FROM public.application_stakeholders
)
UPDATE public.application_stakeholders s
   SET is_primary = true
  FROM ranked r
 WHERE s.id = r.id
   AND r.rn = 1
   AND r.role_has_primary = false;

NOTIFY pgrst, 'reload schema';
