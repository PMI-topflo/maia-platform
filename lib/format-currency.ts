// =====================================================================
// lib/format-currency.ts
//
// CINC-style balance display, the MAIA default for every association
// report and view. Mirrors CINC's Homeowner Listing so a balance reads
// the same everywhere:
//
//   positive (owner owes)  → BLUE, plain     e.g.  $1,767.00
//   negative (credit)      → RED, parentheses e.g. ($247.33)
//   zero                   → muted gray       e.g.  $0.00
//
// Use `formatBalance()` for the text and `balanceColor()` for the color.
// A collections flag is surfaced separately (its own chip / border), not
// by re-coloring the number — the number always follows the sign.
// =====================================================================

export const BALANCE_COLORS = {
  positive: '#2563eb', // owed — blue
  negative: '#dc2626', // credit — red
  zero:     '#6b7280', // paid up — muted gray
} as const

/** Format a dollar amount CINC-style: negatives wrapped in parentheses.
 *  `decimals` defaults to 2 (cents, like CINC); pass 0 for compact whole
 *  dollars. Null / non-finite → an em dash. */
export function formatBalance(amount: number | null | undefined, decimals: 0 | 2 = 2): string {
  if (amount == null || !Number.isFinite(Number(amount))) return '—'
  const n = Number(amount)
  const abs = Math.abs(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })
  // Parenthesize only a real credit — a value that rounds to zero at the
  // chosen precision reads as "$0.00", never "($0.00)".
  const rounds = Math.abs(n) >= 0.5 / 10 ** decimals
  return n < 0 && rounds ? `(${abs})` : abs
}

/** The CINC display color for a balance: blue when owed, red when a credit,
 *  muted gray at zero (or when there's no balance). */
export function balanceColor(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return BALANCE_COLORS.zero
  const n = Number(amount)
  if (n > 0.005) return BALANCE_COLORS.positive
  if (n < -0.005) return BALANCE_COLORS.negative
  return BALANCE_COLORS.zero
}
