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
  subjects: { name: string | null; email?: string | null }[],
  stakeholders: { id: string; name: string | null; email?: string | null }[],
): (string | null)[] {
  const result: (string | null)[] = new Array(subjects.length).fill(null)
  const used = new Set<string>()
  const claim = (i: number, id: string) => { result[i] = id; used.add(id) }
  const email = (e: string | null | undefined) => (e ?? '').trim().toLowerCase()

  // Pass 0: same email -- the one identifier both forms actually share.
  subjects.forEach((s, i) => {
    const e = email(s.email); if (!e) return
    const match = stakeholders.find(h => !used.has(h.id) && email(h.email) === e)
    if (match) claim(i, match.id)
  })

  // Pass 1: exact normalized-name match.
  subjects.forEach((s, i) => {
    if (result[i]) return
    const n = normalizeName(s.name); if (!n) return
    const match = stakeholders.find(h => !used.has(h.id) && normalizeName(h.name) === n)
    if (match) claim(i, match.id)
  })

  // Pass 1b: loose name -- same last name and the first names agree as a
  // prefix either way ("Tim Walker" ~ "Timothy Dean Walker", "Quentin Smith"
  // ~ "Quentin Jamal Smith"). Real case, 2026-09-10 (MANXI 706): the Checkr
  // subject names came from the payment form and were shorter than the
  // applicants' full legal names, so nothing matched and both reports were
  // filed under nobody.
  subjects.forEach((s, i) => {
    if (result[i]) return
    const match = stakeholders.find(h => !used.has(h.id) && looseNameMatch(s.name, h.name))
    if (match) claim(i, match.id)
  })

  // Pass 2: same overall length -> pair whatever's left in order (both lists
  // are primary-first).
  if (subjects.length === stakeholders.length) {
    const unmatchedIdx = result.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0)
    const unmatchedStakeholders = stakeholders.filter(h => !used.has(h.id))
    if (unmatchedIdx.length === unmatchedStakeholders.length) {
      unmatchedIdx.forEach((idx, k) => claim(idx, unmatchedStakeholders[k].id))
    }
  }

  // Pass 3: exactly one subject and exactly one stakeholder left -> they are
  // each other, whatever the lists' overall lengths.
  const leftIdx = result.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0)
  const leftStakeholders = stakeholders.filter(h => !used.has(h.id))
  if (leftIdx.length === 1 && leftStakeholders.length === 1) claim(leftIdx[0], leftStakeholders[0].id)

  return result
}

/** Same last name, and one first name is a prefix of the other (>= 3 chars). */
export function looseNameMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = normalizeName(a).split(' ').filter(Boolean), tb = normalizeName(b).split(' ').filter(Boolean)
  if (ta.length < 2 || tb.length < 2) return false
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false
  const fa = ta[0], fb = tb[0]
  if (fa.length < 3 || fb.length < 3) return false
  return fa.startsWith(fb) || fb.startsWith(fa)
}
