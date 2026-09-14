-- =====================================================================
-- 20260914_associations_board_contact_email.sql
--
-- User direction, 2026-09-14: "We need to add a new email in the
-- database that reaches all board members and onsite manager for
-- scheduling interviews, since the board does not want to show their
-- private emails to applicants — for Manors XI it would be
-- themanorsbuildingxi@gmail.com. All emails that copy the applicants and
-- the board will need to use this."
--
-- associations.board_contact_email — the board's shared mailbox. When set,
-- every email that puts an applicant and the board on the same message
-- (interview introduction, "Start your application" invite with board CC)
-- copies THIS address instead of the members' private emails; the members
-- and on-site managers are BCC'd so they still receive it. Forwarding from
-- the mailbox to the members is configured in that mailbox (Gmail), not
-- in MAIA. Existing table: no GRANT block needed. Idempotent.
-- =====================================================================
ALTER TABLE public.associations ADD COLUMN IF NOT EXISTS board_contact_email text;

UPDATE public.associations SET board_contact_email = 'themanorsbuildingxi@gmail.com'
 WHERE association_code = 'MANXI' AND board_contact_email IS NULL;

NOTIFY pgrst, 'reload schema';
