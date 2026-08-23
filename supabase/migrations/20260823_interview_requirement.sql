-- =====================================================================
-- 20260823_interview_requirement.sql
--
-- User direction, 2026-08-23: "Does it require an interview before
-- approving for leases? and for purchases - THIS IS VERY IMPORTANT,
-- MANORS REQUIRES AN INTERVIEW BEFORE RELEASING THE APPROVAL LETTER ON
-- PURCHASES, SO THE FORM THAT IS SENT TO THE BOARD... WHEN THEY HIT THE
-- FINAL BUTTON TO APPROVE MUST CHANGE ON PURCHASES TO SCHEDULE AN
-- INTERVIEW AND AN EMAIL NEEDS TO BE SENT TO THE TENANT WITH THE BOARD IN
-- COPY FOR THEM INTRODUCING EACH OTHER AND TELLING THEM TO SCHEDULE AT
-- THEIR OWN CONVENIENCE."
--
-- associations.requires_interview_lease / requires_interview_purchase —
-- same per-association-boolean pattern as pets_allowed, one flag per
-- application type since the requirement legitimately differs (MANXI
-- requires it for purchases only, as of this migration).
--
-- listing_applications.interview_requested_at / interview_completed_at —
-- lets lib/board-decision-letter.ts's advanceToApprovalSent() gate the
-- automatic approval-letter creation on a required interview, exactly
-- once (requested_at prevents re-sending the introduction email on every
-- retrigger), and lets staff mark it done to release the real letter.
--
-- Seeds MANXI requires_interview_purchase = true per the user's explicit
-- instruction above. Every other association/flag defaults false — no
-- other association has stated this requirement.
--
-- Idempotent.
-- =====================================================================

ALTER TABLE public.associations
  ADD COLUMN IF NOT EXISTS requires_interview_lease boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_interview_purchase boolean NOT NULL DEFAULT false;

ALTER TABLE public.listing_applications
  ADD COLUMN IF NOT EXISTS interview_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_completed_at timestamptz;

UPDATE public.associations SET requires_interview_purchase = true WHERE association_code = 'MANXI';

NOTIFY pgrst, 'reload schema';
