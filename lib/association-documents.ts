// =====================================================================
// lib/association-documents.ts
//
// Shared types + taxonomy for the association_documents feature:
//   - the categorical groups staff classify uploads/links under
//   - DB row type so server + client agree on shape
//   - small helpers reused by the API route and the chat handler
//
// The taxonomy spans:
//   Governance       — declaration, bylaws, rules, articles
//   Financial        — budget, reserve study, audit
//   Operations       — board meeting minutes
//   Insurance        — Florida HOA/condo standard policies (per the
//                      complete checklist staff drafted, including
//                      master, GL, D&O, fidelity, workers comp,
//                      umbrella, flood, cyber, equipment breakdown,
//                      ordinance & law, windstorm)
//   Florida-specific — structural integrity reserve study, wind
//                      mitigation report, roof inspection (SB 4-D /
//                      condo safety law requirements)
//   Vendors          — COIs, contracts
//   Other            — correspondence, misc
//
// Why text categories rather than an enum: the list will grow (e.g.
// "milestone inspection report" once more buildings hit the trigger)
// and we don't want a migration per addition. The CATEGORY_KEYS const
// is the source of truth; anything outside it gets normalized to
// 'other' on save.
// =====================================================================

export const STORAGE_BUCKET = 'association-documents'

export interface CategoryDef {
  key:    string
  label:  string
  group:  string
  /** When true, the UI prompts for effective_date + expiry_date because
   *  the document is policy-shaped (insurance, board terms, etc). */
  dated?: boolean
}

// Phase 1 scope: just the two documents new tenants / buyers see and
// e-sign during the application flow. The table + storage bucket are
// built to handle a wider taxonomy (insurance, financials, etc.) but
// staff said to land this incrementally — start with the docs that
// gate the application signature, expand later.
//
// Adding categories later is one-liner: append to this array; nothing
// else has to change because category is a text column, not an enum.
export const CATEGORIES: CategoryDef[] = [
  // Governing documents (also gate the application e-sign flow).
  { key: 'condo_docs', group: 'Governing Documents', label: 'Condo Docs / Declaration' },
  { key: 'rules_regs', group: 'Governing Documents', label: 'Rules & Regulations' },
  // Forms & applications — Application Forms is a temporary home for each
  // association's application paperwork until the in-Maia application is built.
  { key: 'application_forms', group: 'Forms & Applications', label: 'Application Forms' },
  { key: 'ach_forms',         group: 'Forms & Applications', label: 'ACH Authorization' },
  { key: 'arc',               group: 'Forms & Applications', label: 'ARC / Architectural Request' },
  // Financials.
  { key: 'financials', group: 'Financials', label: 'Financials', dated: true },
  { key: 'budget',     group: 'Financials', label: 'Budget', dated: true },
  // Property & records.
  { key: 'insurance',       group: 'Property & Records', label: 'Insurance', dated: true },
  { key: 'maintenance',     group: 'Property & Records', label: 'Maintenance' },
  { key: 'leases_resale',   group: 'Property & Records', label: 'Leases & Resale' },
  { key: 'welcome_letters', group: 'Property & Records', label: 'Welcome Letters' },
  { key: 'faq',             group: 'Property & Records', label: 'FAQ' },
]

/** Categories surfaced to tenant / buyer applicants during the apply
 *  flow. The application requires acknowledgment of every document in
 *  this list (or at least one row of each category) before signature. */
export const APPLICATION_REQUIRED_CATEGORIES: ReadonlySet<string> = new Set([
  'condo_docs',
  'rules_regs',
])

export const CATEGORY_KEYS = new Set(CATEGORIES.map(c => c.key))

export function categoryLabel(key: string): string {
  return CATEGORIES.find(c => c.key === key)?.label ?? key
}

export function categoryGroup(key: string): string {
  return CATEGORIES.find(c => c.key === key)?.group ?? 'Other'
}

/** Group the categories by their `group` field — used by the upload UI
 *  to render <optgroup>s and to lay out the documents page by section. */
export function categoriesByGroup(): Array<{ group: string; items: CategoryDef[] }> {
  const seen = new Map<string, CategoryDef[]>()
  for (const c of CATEGORIES) {
    const arr = seen.get(c.group) ?? []
    arr.push(c)
    seen.set(c.group, arr)
  }
  return [...seen.entries()].map(([group, items]) => ({ group, items }))
}

export type DocumentSource = 'upload' | 'drive_link' | 'note'
export type ExtractionStatus = 'pending' | 'extracting' | 'done' | 'failed' | 'skipped' | 'unsupported'

export interface AssociationDocument {
  id:                 string
  association_code:   string
  category:           string
  subcategory:        string | null
  source:             DocumentSource
  storage_path:       string | null
  drive_url:          string | null
  filename:           string
  mime_type:          string | null
  file_size_bytes:    number | null
  extracted_text:     string | null
  extraction_status:  ExtractionStatus
  extraction_error:   string | null
  effective_date:     string | null   // YYYY-MM-DD
  expiry_date:        string | null
  notes:              string | null
  uploaded_by_email:  string | null
  /** Soft-archive flag. NULL when this is a current (active) version.
   *  Set when a newer upload supersedes it OR staff explicitly archives
   *  it. Archived rows still hold their storage object so a restore
   *  doesn't require re-uploading the file. */
  archived_at:        string | null
  archived_by_email:  string | null
  /** ISO 639-1 language code of the document content (en/es/pt/...).
   *  Defaults to 'en' for legacy rows. Lets the same association have
   *  multiple language versions of the same category — applicant picks
   *  which one to read + sign. */
  language:           string
  /** When true, the document shows on the association's main page to the
   *  general public (no login). Defaults false — staff opt in per document. */
  is_public:          boolean
  created_at:         string
  updated_at:         string
}

/** Languages MAIA's apply flow supports. Keep aligned with the
 *  translations in components/ApplicationForm.tsx — adding a new
 *  language requires updating both this list and the translation
 *  blocks. */
export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'he', label: 'עברית' },
  { code: 'ru', label: 'Русский' },
]

export function languageLabel(code: string): string {
  return SUPPORTED_LANGUAGES.find(l => l.code === code)?.label ?? code.toUpperCase()
}

/** Returns true when the file's mime + extension suggest we can pull
 *  text out of it via pdf-parse. Conservative — we'd rather mark a
 *  document `unsupported` than try and crash mid-request. */
export function isExtractableMime(mime: string | null | undefined, filename: string | null | undefined): boolean {
  const m = (mime ?? '').toLowerCase()
  const n = (filename ?? '').toLowerCase()
  return m === 'application/pdf' || n.endsWith('.pdf')
}
