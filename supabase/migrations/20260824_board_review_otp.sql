-- User direction, 2026-08-24: "the page link for the board to choose who
-- are they and approve the documents, should have an initial 2FA
-- verification." Previously the round's token WAS the only capability —
-- app/api/board-review/[token]/route.ts's own comment said so explicitly
-- ("a board member should not need an account... the round's token is the
-- capability") — anyone holding the link could self-report as any named
-- reviewer and approve/refuse real documents with zero identity check.
--
-- reviewer_verifications tracks, per round, which named reviewer has
-- completed an email OTP challenge and when — checked server-side on every
-- decide/finalize call, valid for 30 days (REVIEWER_VERIFICATION_DAYS in
-- lib/board-review-verify.ts) so a board member working through a round
-- over a few days doesn't re-verify every visit. Shape:
--   { [reviewerNameLowercased]: { email: string, verifiedAt: iso8601 } }

alter table public.document_review_rounds
  add column if not exists reviewer_verifications jsonb not null default '{}'::jsonb;
