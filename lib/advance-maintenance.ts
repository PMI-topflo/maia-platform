// =====================================================================
// lib/advance-maintenance.ts
//
// How many quarterly maintenance assessments a PURCHASE applicant must pay
// in advance, from the association's own rule rows — never hard-coded to an
// association. Board direction (Manors XI, 2026-09-10): "the approval letter
// should show the number of pre-paid assessments by the credit score."
//
// Reads two association_application_rules rows when present:
//   credit_score_advance_maintenance
//     value: { "635-660": "1 year advance maintenance",
//              "661-750": "6 months advance maintenance",
//              "751-850": "no advance maintenance required" }
//   international_no_credit_advance_maintenance
//     value: { "international": "1 year advance maintenance" }
//
// The band text is parsed for a duration ("1 year" → 12 months → 4 quarters,
// "6 months" → 2 quarters, "no …" → 0). An association without these rules
// gets null, and the letter prints nothing about it.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface AdvanceMaintenance {
  /** Quarterly assessments to prepay (0 = none required). */
  quarters: number
  months: number
  /** e.g. "credit score 692 (661–750)" or "international applicant, no U.S. credit history" */
  basis: string
  /** The unit's current quarterly assessment, when the ledger shows one. */
  quarterlyAmount: number | null
  total: number | null
}

/** "1 year advance maintenance" → 12, "6 months …" → 6, "no advance …" → 0, unparseable → null */
export function monthsFromRuleText(text: string): number | null {
  const t = text.toLowerCase()
  if (/^\s*(no|none|not)\b/.test(t) || /\bnone\b|\bnot required\b|\bno advance\b/.test(t)) return 0
  const y = t.match(/(\d+(?:\.\d+)?)\s*(year|yr)/); if (y) return Math.round(Number(y[1]) * 12)
  const m = t.match(/(\d+)\s*month/); if (m) return Number(m[1])
  const q = t.match(/(\d+)\s*quarter/); if (q) return Number(q[1]) * 3
  return null
}

function bandMatches(band: string, score: number): boolean {
  const m = band.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (!m) return false
  return score >= Number(m[1]) && score <= Number(m[2])
}

/** Resolve the requirement for one applicant. `international` = the
 *  applicant declared they have no 2 years of U.S. tax returns. */
export async function advanceMaintenanceFor(input: {
  associationCode: string
  creditScore: number | null
  international: boolean
  quarterlyAmount: number | null
}): Promise<AdvanceMaintenance | null> {
  const { data: rules } = await supabaseAdmin.from('association_application_rules')
    .select('rule_key, value').eq('association_code', input.associationCode.toUpperCase()).eq('active', true)
    .in('rule_key', ['credit_score_advance_maintenance', 'international_no_credit_advance_maintenance'])
  const byKey = new Map((rules ?? []).map(r => [String(r.rule_key), r.value as Record<string, string> | null]))

  let months: number | null = null
  let basis = ''
  if (input.international) {
    const v = byKey.get('international_no_credit_advance_maintenance')
    const text = v ? Object.values(v)[0] : null
    if (text) { months = monthsFromRuleText(String(text)); basis = 'international applicant, no U.S. credit history' }
  } else if (input.creditScore != null) {
    const v = byKey.get('credit_score_advance_maintenance')
    if (v) {
      const band = Object.keys(v).find(b => bandMatches(b, input.creditScore as number))
      if (band) { months = monthsFromRuleText(String(v[band])); basis = `credit score ${input.creditScore} (${band.replace('-', '–')})` }
    }
  }
  if (months == null) return null
  const quarters = Math.ceil(months / 3)
  const total = input.quarterlyAmount != null ? Math.round(input.quarterlyAmount * quarters * 100) / 100 : null
  return { quarters, months, basis, quarterlyAmount: input.quarterlyAmount, total }
}

export const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The sentence the approval letter prints. */
export function advanceMaintenanceSentence(a: AdvanceMaintenance): string {
  if (a.quarters === 0) return `No advance maintenance is required (${a.basis}).`
  const period = a.months % 12 === 0 ? `${a.months / 12} year${a.months / 12 === 1 ? '' : 's'}` : `${a.months} months`
  const amounts = a.quarterlyAmount != null && a.total != null
    ? ` — ${a.quarters} quarterly assessment${a.quarters === 1 ? '' : 's'} of ${money(a.quarterlyAmount)}, ${money(a.total)} in total`
    : ` (${a.quarters} quarterly assessment${a.quarters === 1 ? '' : 's'})`
  // Paid AT closing, not before: the title company holds the funds and remits
  // them to the Association as stated in the estoppel letter (user direction,
  // 2026-09-10).
  return `Based on the ${a.basis}, the Association requires ${period} of maintenance assessments to be paid in advance at closing${amounts}. The title company is responsible for holding these funds and remitting them to the Association as stated in the estoppel letter.`
}
