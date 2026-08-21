-- =====================================================================
-- 20260821_retire_board_approval_letter_purchase_ao.sql
--
-- Same fix as 20260821_retire_board_approval_letter_new_lease.sql,
-- extended to MANXI's `purchase` and `additional_occupant` checklists,
-- per direct user request the same day ("do the same for purchase and
-- additional_occupant").
--
-- Checked both before retiring, same method as the lease check:
--   purchase (3 applications): one board_approval_letter document ever
--     filed, uploaded_by_role = 'esign' — MAIA's own automatic filing of
--     THIS application's signed board decision letter (lib/esign.ts),
--     not an owner responding to the intake ask.
--   additional_occupant (1 application): zero board_approval_letter
--     documents ever filed.
--
-- Neither type has ever had this item genuinely fulfilled by a landlord.
-- Soft-deactivated (active = false), same mechanism as the lease,
-- landlord_email and pet_esa_documents retirements. NOT touched:
-- lease_renewal, which keeps its relabel ("Copy of Last Year's Approval
-- Letter") — a prior year's letter is a real thing there.
--
-- Idempotent.
-- =====================================================================

UPDATE public.association_intake_documents
   SET active = false, updated_at = now()
 WHERE association_code = 'MANXI'
   AND application_type IN ('purchase', 'additional_occupant')
   AND doc_key = 'board_approval_letter';

NOTIFY pgrst, 'reload schema';
