-- =====================================================================
-- pmi_staff — gate the global communications view
--
-- Default false. Set TRUE for staff who need to see every email +
-- conversation across the company (e.g. owner, billing lead). Other
-- staff only see communications where they're the sender, recipient,
-- or one of their alt_emails matches.
--
-- This is separate from the existing `role` column (which is used for
-- display + skill routing) so permission changes don't accidentally
-- shift a staff member's queue assignment.
-- =====================================================================

ALTER TABLE public.pmi_staff
  ADD COLUMN IF NOT EXISTS can_see_all_communications boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pmi_staff.can_see_all_communications IS
  'When true, this staff member sees every conversation + email in /admin/communications. When false (default), they only see ones where they are the sender, recipient, or one of their alt_emails matches.';
