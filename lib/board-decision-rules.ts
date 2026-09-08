// =====================================================================
// lib/board-decision-rules.ts
//
// The association's OWN governing-document language on how long the Board
// has to decide a transfer application -- verbatim, per association, never
// paraphrased. Same precedent as lib/manxi-rules-ack.ts / lib/vpci-rules-ack.ts
// (per-association legal text lives in code, reviewed via PR, rather than a
// DB field anyone could edit casually) -- a wrong "what happens after 30
// days" statement in front of a board is a real liability, so this returns
// null (nothing shown) rather than a guess for any association not
// confirmed here.
//
// MANXI confirmed 2026-09-08 -- user supplied the association's own
// "Amendment to Rules and Regulations" PDF (11.20 Amendment, MANXI),
// Section on application processing:
//   "The Board of Directors must process the application and either
//    approve or disapprove the transaction within thirty (30) days upon
//    receipt of all required documents and fees. This timeframe applies to
//    both sales and rentals."
// No consequence for a missed deadline is stated in that document -- so
// none is asserted here either; this is quoted exactly as written, nothing
// added.
//
// VPCI confirmed 2026-09-08 -- ALREADY extracted, from VPCI_INSTRUCTIONS[1]
// in lib/vpci-rules-ack.ts (the same text the rules-knowledge-acknowledgment
// e-sign document shows applicants, sourced from the Declaration itself),
// not a fresh document: "The Board of Directors reviews every completed
// application and, per the Declaration (Article XXII), must approve or
// disapprove it IN WRITING within ten (10) business days of receiving it
// (plus any additional information the Board requests) — if the Board does
// not respond within that window, the application is deemed approved." Note
// this is TEN BUSINESS DAYS, not the 30-CALENDAR-DAY window lib/board-
// review.ts otherwise assumes as the default (board_window_days) -- worth
// confirming VPCI's own board_window_days matches its Declaration.
// =====================================================================

const BOARD_DECISION_RULE: Record<string, string> = {
  MANXI: 'The Board of Directors must process the application and either approve or disapprove the transaction within thirty (30) days upon receipt of all required documents and fees. This timeframe applies to both sales and rentals.',
  VPCI: 'Per the Declaration (Article XXII), the Board must approve or disapprove the application IN WRITING within ten (10) business days of receiving it (plus any additional information the Board requests). If the Board does not respond within that window, the application is deemed approved.',
}

/** The association's own verbatim rule on the Board's decision timeframe, or
 *  null if it hasn't been confirmed for this association yet -- callers must
 *  not fall back to a generic/assumed sentence in that case. */
export function boardDecisionRuleFor(associationCode: string): string | null {
  return BOARD_DECISION_RULE[associationCode.trim().toUpperCase()] ?? null
}
