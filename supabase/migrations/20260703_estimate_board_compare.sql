-- =====================================================================
-- 20260703_estimate_board_compare.sql
--
-- Board-picks estimate comparison. Previously staff pre-chose ONE vendor
-- and the board approved that one. Now staff send the WHOLE comparison and
-- each board member picks which vendor they approve:
--   estimate_approval_reviews.selected_vendor_request_id
--     — the estimate_request_vendors row this signer approved.
--   estimate_approvals.recommended_vendor_request_id
--     — optional staff "recommended" highlight (the board may override).
--
-- The approval's own vendor_request_id / vendor_name / amount stay NULL
-- until enough signers pick the SAME vendor; finalize then stamps the
-- winner onto the approval row (so finalizeEstimateApproval is unchanged).
--
-- Both columns are on EXISTING tables → no new grants. Idempotent.
-- (Requires 20260610_estimate_board_approval.sql first.)
-- =====================================================================

ALTER TABLE public.estimate_approval_reviews
  ADD COLUMN IF NOT EXISTS selected_vendor_request_id uuid;

ALTER TABLE public.estimate_approvals
  ADD COLUMN IF NOT EXISTS recommended_vendor_request_id uuid;

NOTIFY pgrst, 'reload schema';
