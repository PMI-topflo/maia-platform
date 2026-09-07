// =====================================================================
// lib/screening/stakeholder-match.ts
// Best-effort match between screening subjects (Checkr's own applicant
// records, built from the legacy applications.applicants[] array at
// order-creation time) and application_stakeholders rows (the new,
// per-stakeholder table) -- there's no shared id between the two, only
// names entered independently in two different forms.
//
// Used ONCE, at order-creation time (app/api/trigger-screening/route.ts),
// to set screening_subjects.stakeholder_id -- everything downstream
// (webhook auto-file, the manual re-file button, the checklist row)
// then reads that stored id directly instead of re-guessing by name
// every time. Kept as a fallback in lib/screening/report-storage.ts for
// subjects created before this column existed.
// =====================================================================

export const normalizeName = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ')

/** Returns one stakeholder id (or null) per subject, in the same order as
 *  `subjects`. Each stakeholder is used at most once.
 *
 *  Pass 1: exact normalized-name match.
 *  Pass 2: if the two lists are the SAME length overall (so there's no
 *  ambiguity from occupants or a partial submission), pair whatever's left
 *  unmatched in order -- both lists are naturally primary-first (subjects
 *  from the original application's own order, stakeholders sorted
 *  is_primary desc/created_at asc), so this catches a name that didn't
 *  normalize to an exact match (a nickname, a Checkr-added middle name)
 *  without guessing across a list of more than one genuine ambiguity. */
export function matchStakeholders(
  subjects: { name: string | null }[],
  stakeholders: { id: string; name: string | null }[],
): (string | null)[] {
  const result: (string | null)[] = new Array(subjects.length).fill(null)
  const used = new Set<string>()

  subjects.forEach((s, i) => {
    const n = normalizeName(s.name)
    if (!n) return
    const match = stakeholders.find(h => !used.has(h.id) && normalizeName(h.name) === n)
    if (match) { result[i] = match.id; used.add(match.id) }
  })

  if (subjects.length === stakeholders.length) {
    const unmatchedIdx = result.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0)
    const unmatchedStakeholders = stakeholders.filter(h => !used.has(h.id))
    if (unmatchedIdx.length === unmatchedStakeholders.length) {
      unmatchedIdx.forEach((idx, k) => { result[idx] = unmatchedStakeholders[k].id })
    }
  }

  return result
}
