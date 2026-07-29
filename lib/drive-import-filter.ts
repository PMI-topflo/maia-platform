// =====================================================================
// lib/drive-import-filter.ts
//
// Doc-type whitelist for the Drive bulk importer. The per-unit Drive folders
// mix the compliance docs we WANT (board approvals, Lauderhill Certificate of
// Use, insurance HO-6/HO-4, leases) with sensitive PII we must NOT pull (IDs,
// credit reports, criminal/background reports, tax returns).
//
// The decision is made from the FILE NAME + FOLDER PATH only — never by
// downloading the file — precisely so a PII document is never fetched just to
// classify it. PII (skip) patterns take precedence over include patterns, and
// anything unrecognized is skipped by default (surfaced for review).
// =====================================================================

export type FilterCategory =
  | 'approval' | 'certificate_of_use' | 'insurance' | 'lease'   // include
  | 'id' | 'credit' | 'criminal' | 'tax'                        // skip (PII)
  | 'unknown'

export interface FilterDecision {
  include: boolean
  category: FilterCategory
  reason: string
}

// PII / sensitive — checked FIRST; any match means skip, even if an include
// pattern also matches (e.g. "tenant ID + lease.pdf").
const SKIP: { category: FilterCategory; re: RegExp; reason: string }[] = [
  { category: 'id',       re: /\b(driver'?s?\s*licen[sc]e|drivers?\s*lic|\bdl\b|passport|state\s*id|photo\s*id|identification|green\s*card|resident\s*card|social\s*security|\bssn\b)\b/i, reason: 'looks like a government ID / SSN' },
  { category: 'credit',   re: /\b(credit\s*(report|check|score)|equifax|transunion|trans\s*union|experian|\bfico\b)\b/i, reason: 'looks like a credit report' },
  // `full_report` / `screening` = the Checkr background/screening report PDF.
  { category: 'criminal', re: /(\b(criminal|background\s*(check|report)|arrest|eviction\s*(report|history)|checkr|clearance|screening)\b|full_?report)/i, reason: 'looks like a criminal / background / screening report' },
  { category: 'tax',      re: /(\b(tax\s*return|1040|\bw-?2\b|\bw2\b|1099|\birs\b)\b|pay\s?-?stub)/i, reason: 'looks like a tax return / income doc (paystub, W-2)' },
]

// Compliance docs we WANT.
const INCLUDE: { category: FilterCategory; re: RegExp; reason: string }[] = [
  // NOTE: bare "renewal" is intentionally NOT here — a "lease renewal agreement"
  // is a lease, not the board's approval. A renewal that IS a board approval
  // still matches "board approval".
  { category: 'approval',           re: /\b(board\s*approval|approval\s*letter|approved|new\s*tenant|new\s*owner|application\s*approv)\b/i, reason: 'board approval letter' },
  { category: 'certificate_of_use', re: /(\b(certificate\s*of\s*use|cert\.?\s*of\s*use|use\s*permit|lauderhill|business\s*tax\s*receipt|\bbtr\b)\b|\bcou[_\s\-]?\d|\bcou\b|\blaud\b.*\b(bus|lic)|bus\.?\s*lic\b)/i, reason: 'Certificate of Use / Lauderhill rental license' },
  { category: 'insurance',          re: /(\b(insurance|insur|\bho-?6\b|\bho-?4\b|policy|declaration\s*page|dec\s*page|\bcoi\b|acord|certificate\s*of\s*insurance|homeowners?|binder|citizens)\b)/i, reason: 'insurance document' },
  { category: 'lease',              re: /\b(lease|rental\s*agreement|tenancy|residential\s*agreement)\b/i, reason: 'lease' },
]

/** Decide whether a Drive file should be imported, from its name + folder path.
 *  `whitelistOn=false` disables the filter (import everything, original
 *  behavior) — the filter is opt-in. `isGoogleDoc` marks a Google-native
 *  editor file: the SIGNED board approval letters live as PDFs (exported from
 *  SignNow); a Google Doc of an approval is the editable DRAFT, so we skip it
 *  (per the "signed PDF only" rule). Google Docs of other types are still fine. */
export function filterDriveFile(name: string, path: string | null | undefined, whitelistOn = true, isGoogleDoc = false): FilterDecision {
  if (!whitelistOn) return { include: true, category: 'unknown', reason: 'whitelist off' }
  const hay = `${path ?? ''} / ${name}`

  for (const s of SKIP) {
    if (s.re.test(hay)) return { include: false, category: s.category, reason: s.reason }
  }
  for (const inc of INCLUDE) {
    if (inc.re.test(hay)) {
      if (inc.category === 'approval' && isGoogleDoc) {
        return { include: false, category: 'approval', reason: 'approval draft (Google Doc) — the signed PDF is the one to import' }
      }
      return { include: true, category: inc.category, reason: inc.reason }
    }
  }
  return { include: false, category: 'unknown', reason: 'unrecognized document type' }
}

export const INCLUDE_CATEGORIES: FilterCategory[] = ['approval', 'certificate_of_use', 'insurance', 'lease']
