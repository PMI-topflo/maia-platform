// =====================================================================
// lib/board-review-verify.ts
//
// Identity verification for the board-review round — a named reviewer must
// complete a one-time email code before deciding anything, then stays
// verified for REVIEWER_VERIFICATION_DAYS so they don't re-verify on every
// visit while working through a round. Mirrors lib/esign-verify.ts's
// pattern (namespaced otp_verifications identifier, mask helper reused
// from there), but simpler by design — email only, no phone/geo — this is
// "who is deciding," not a signed legal document.
// =====================================================================

export const REVIEWER_VERIFICATION_DAYS = 30

export interface ReviewerVerifications {
  [reviewerNameLower: string]: { email: string; verifiedAt: string }
}

/** Namespaced so board-review codes never collide with esign/login OTPs in
 *  the shared otp_verifications table. */
export function boardReviewOtpIdentifier(roundId: string, name: string, email: string): string {
  return `br:${roundId}:${name.trim().toLowerCase()}:${email.trim().toLowerCase()}`
}

/** True when this reviewer verified within the last 30 days, for THIS
 *  round. A new round (new document batch) starts unverified again — its
 *  own token is short-lived enough that this doesn't meaningfully add
 *  friction, and it keeps the trust boundary scoped to what's actually
 *  being decided right now. */
export function isReviewerVerified(verifications: ReviewerVerifications, name: string): boolean {
  const v = verifications[name.trim().toLowerCase()]
  if (!v?.verifiedAt) return false
  const ageMs = Date.now() - new Date(v.verifiedAt).getTime()
  return ageMs < REVIEWER_VERIFICATION_DAYS * 24 * 60 * 60 * 1000
}

export function withReviewerVerified(verifications: ReviewerVerifications, name: string, email: string): ReviewerVerifications {
  return { ...verifications, [name.trim().toLowerCase()]: { email: email.trim().toLowerCase(), verifiedAt: new Date().toISOString() } }
}
