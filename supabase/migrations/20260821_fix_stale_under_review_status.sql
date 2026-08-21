-- =====================================================================
-- 20260821_fix_stale_under_review_status.sql
--
-- Corrects two applications (MANXI 801, MANXI 901) whose status was set to
-- 'under_review' via the old, since-retired "Mark audited" button (superseded
-- by PR4's automatic submitted -> under_review transition, 2026-08-20) —
-- that button never checked document completeness, a footgun already
-- called out in this session's own PR8 notes.
--
-- User report, 2026-08-21: "check all stages status, I think that they are
-- not matching with what was developed... 901, I just sent a message for
-- additional info/documents, why is in Documents approved - creating
-- letter?" Checked every open application's live review state against its
-- status column; these two disagreed:
--   MANXI 801 (Jane Bruna, lease):  0 of 16 required documents ever decided.
--   MANXI 901 (Shadia Boyd, lease renewal): 3 of 7 required documents
--     decided, 4 still waiting (including the two just re-requested).
--
-- Reverted to 'submitted' — what their actual document state already says —
-- so the real automatic pipeline (lib/board-review.ts's syncBoardWindow) can
-- correctly re-advance each once its documents are genuinely complete,
-- instead of sitting permanently mislabeled.
--
-- Idempotent (WHERE clause re-checks status so a second run is a no-op).
-- =====================================================================

UPDATE public.listing_applications
   SET status = 'submitted', updated_at = now()
 WHERE id IN ('e210870d-9658-4f5e-89ef-505e5d4eba98', 'e9da3aca-bcae-4eff-9452-3f75cc315750')
   AND status = 'under_review';
