// =====================================================================
// lib/coi-validation.ts
//
// Validates a vendor's Certificate of Insurance (COI):
//   1. not expired, and
//   2. lists BOTH "PMI Top Florida Properties" AND the job's association
//      as additional insured (or certificate holder).
//
// Insurers mangle names AND addresses constantly — including PMI's own
// name and the association's. So matching is FUZZY on both, anchored on
// the strongest signals (street number + ZIP + core name tokens) and
// tolerant of typos / shortened or missing words. We only fail an entity
// when it is genuinely ABSENT or an anchor is clearly different — never
// over a typo like "PMI Top Floryda" or "Ives Dairy Rd".
//
// PR1 = pure engine (no enforcement, no UI). lib/vendor-doc-extraction.ts
// feeds it the COI entities; PR2 wires the verdict into the compliance
// status, the block guard, and the correction-email draft.
// =====================================================================

import type { CoiEntity, VendorDocExtraction } from '@/lib/vendor-doc-extraction'

// PMI's own entity — must appear as additional insured on every vendor COI.
export const PMI_ENTITY: CoiTargetEntity = {
  name:    'PMI Top Florida Properties',
  address: '1031 Ives Dairy Road, Suite 228, Miami, FL 33179',
}

/** An entity we need to find on the COI (PMI, or a job's association). */
export interface CoiTargetEntity {
  name:    string
  address: string | null   // street + city + state + ZIP when known
}

export interface CoiVerdict {
  status:             'valid' | 'invalid' | 'expiring' | 'unverifiable'
  expired:            boolean
  expiresInDays:      number | null
  pmiListed:          boolean
  associationListed:  boolean
  matchedPmi:         string | null   // the COI entity that matched PMI
  matchedAssociation: string | null
  issues:             string[]        // human-readable problems (empty when valid)
}

// ── Normalization ────────────────────────────────────────────────────────────

// Entity-type noise stripped before name matching — what remains is the
// distinctive core ("brook haven", "pmi top florida").
const ORG_NOISE =
  /\b(llc|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pa|pllc|the|of|association|assoc|condominium|condo|homeowners|hoa|owners|properties|property|management|mgmt)\b/g

export function normalizeOrgName(s: string): string {
  return ` ${s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')} `
    .replace(/\s+/g, ' ')
    .replace(ORG_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ADDR_ABBR: [RegExp, string][] = [
  [/\bste\b/g, 'suite'], [/\bapt\b/g, 'apartment'], [/\bunit\b/g, 'unit'],
  [/\bst\b/g, 'street'], [/\bave\b/g, 'avenue'], [/\bavenue\b/g, 'avenue'],
  [/\bblvd\b/g, 'boulevard'], [/\brd\b/g, 'road'], [/\bdr\b/g, 'drive'],
  [/\bln\b/g, 'lane'], [/\bct\b/g, 'court'], [/\bpl\b/g, 'place'],
  [/\bpkwy\b/g, 'parkway'], [/\bhwy\b/g, 'highway'], [/\bcir\b/g, 'circle'],
  [/\bter\b/g, 'terrace'], [/\bn\b/g, 'north'], [/\bs\b/g, 'south'],
  [/\be\b/g, 'east'], [/\bw\b/g, 'west'], [/\bfl\b/g, 'florida'],
]

export function normalizeAddress(s: string): string {
  let t = ` ${s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `
  for (const [re, rep] of ADDR_ABBR) t = t.replace(re, rep)
  return t.replace(/\s+/g, ' ').trim()
}

/** Leading street number (first number group). */
function streetNumber(addr: string): string | null {
  const m = addr.match(/\b(\d{1,6})\b/)
  return m ? m[1] : null
}
/** 5-digit ZIP (last 5-digit group, ZIP+4 tolerated). */
function zip(addr: string): string | null {
  const all = addr.match(/\b(\d{5})(?:-\d{4})?\b/g)
  return all && all.length ? all[all.length - 1].slice(0, 5) : null
}

// ── Fuzzy matching ───────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

function nameTokens(s: string): string[] {
  return normalizeOrgName(s).split(' ').filter(t => t.length >= 2)
}

/** Fraction of the TARGET's tokens found in the candidate, allowing 1 edit
 *  on tokens ≥4 chars (so "floryda" still matches "florida"). */
function nameScore(targetTokens: string[], candTokens: string[]): number {
  if (!targetTokens.length || !candTokens.length) return 0
  let hits = 0
  for (const t of targetTokens) {
    if (candTokens.some(c => c === t || (t.length >= 4 && Math.abs(c.length - t.length) <= 2 && levenshtein(t, c) <= 1))) hits++
  }
  return hits / targetTokens.length
}

/** True only when BOTH sides print a street number and ZIP and both equal. */
function addressAnchorsMatch(target: string | null, cand: string | null): boolean {
  if (!target || !cand) return false
  const ta = normalizeAddress(target), ca = normalizeAddress(cand)
  const tNum = streetNumber(ta), cNum = streetNumber(ca)
  const tZip = zip(ta), cZip = zip(ca)
  if (!tNum || !cNum || !tZip || !cZip) return false
  return tNum === cNum && tZip === cZip
}

/** Is `target` present among `candidates`? Strong name overlap confirms on
 *  its own; matching address anchors confirm even when the name is mangled
 *  (and vice-versa). Returns the matched candidate's name, or null. */
export function findEntity(target: CoiTargetEntity, candidates: CoiEntity[]): string | null {
  const tTokens = nameTokens(target.name)
  let best: { name: string; score: number } | null = null
  for (const c of candidates) {
    const ns       = nameScore(tTokens, nameTokens(c.name))
    const anchored = addressAnchorsMatch(target.address, c.address)
    // Name overlap alone (≥0.6), OR address anchors + at least one shared
    // name token (≥0.25) so a mangled name riding the right address passes.
    const present = ns >= 0.6 || (anchored && ns >= 0.25)
    if (present) {
      const score = ns + (anchored ? 1 : 0)
      if (!best || score > best.score) best = { name: c.name, score }
    }
  }
  return best ? best.name : null
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const EXPIRING_SOON_DAYS = 30

/** Validate a parsed COI against PMI + the job's association.
 *  `today` is injectable for testing. */
export function validateCoi(
  coi: VendorDocExtraction['coi'] | null | undefined,
  expirationDate: string | null | undefined,
  association: CoiTargetEntity,
  today: Date = new Date(),
): CoiVerdict {
  const issues: string[] = []

  // The set of entities the certificate protects (additional insured ∪ holder).
  const listed: CoiEntity[] = [
    ...(coi?.additionalInsured ?? []),
    ...(coi?.certificateHolder ? [coi.certificateHolder] : []),
  ]

  // Expiry.
  let expired = false
  let expiresInDays: number | null = null
  if (expirationDate && /^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    const exp = new Date(expirationDate + 'T00:00:00Z')
    const day = 24 * 60 * 60 * 1000
    expiresInDays = Math.floor((exp.getTime() - Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z')) / day)
    expired = expiresInDays < 0
    if (expired) issues.push(`COI expired ${expirationDate} (${-expiresInDays} day(s) ago).`)
  }

  // Can't read who's covered → don't fail, flag for manual review.
  if (listed.length === 0) {
    return {
      status: 'unverifiable', expired, expiresInDays,
      pmiListed: false, associationListed: false,
      matchedPmi: null, matchedAssociation: null,
      issues: [...issues, 'Could not read the additional-insured / certificate-holder entities — verify by hand.'],
    }
  }

  const matchedPmi         = findEntity(PMI_ENTITY, listed)
  const matchedAssociation = findEntity(association, listed)
  const pmiListed          = matchedPmi !== null
  const associationListed  = matchedAssociation !== null

  if (!pmiListed) issues.push(`${PMI_ENTITY.name} is not listed as additional insured.`)
  if (!associationListed) issues.push(`${association.name} is not listed as additional insured.`)

  const status: CoiVerdict['status'] =
    expired || !pmiListed || !associationListed ? 'invalid'
    : expiresInDays !== null && expiresInDays <= EXPIRING_SOON_DAYS ? 'expiring'
    : 'valid'

  return { status, expired, expiresInDays, pmiListed, associationListed, matchedPmi, matchedAssociation, issues }
}
