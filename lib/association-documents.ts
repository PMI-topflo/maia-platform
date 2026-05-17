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

export const CATEGORIES: CategoryDef[] = [
  // Governance ───────────────────────────────────────────────────────
  { key: 'declaration',           group: 'Governance',       label: 'Declaration / Master Deed' },
  { key: 'bylaws',                group: 'Governance',       label: 'Bylaws' },
  { key: 'articles_incorp',       group: 'Governance',       label: 'Articles of Incorporation' },
  { key: 'rules_regs',            group: 'Governance',       label: 'Rules & Regulations' },

  // Financial ────────────────────────────────────────────────────────
  { key: 'budget',                group: 'Financial',        label: 'Current Year Budget',          dated: true },
  { key: 'reserve_study',         group: 'Financial',        label: 'Reserve Study',                dated: true },
  { key: 'audit',                 group: 'Financial',        label: 'Annual Audit / Financials',    dated: true },

  // Operations ───────────────────────────────────────────────────────
  { key: 'board_minutes',         group: 'Operations',       label: 'Board Meeting Minutes',        dated: true },
  { key: 'correspondence',        group: 'Operations',       label: 'Important Correspondence' },

  // Insurance ────────────────────────────────────────────────────────
  { key: 'ins_property',          group: 'Insurance',        label: 'Property / Master Policy',     dated: true },
  { key: 'ins_general_liability', group: 'Insurance',        label: 'General Liability',            dated: true },
  { key: 'ins_do',                group: 'Insurance',        label: 'Directors & Officers (D&O)',   dated: true },
  { key: 'ins_fidelity',          group: 'Insurance',        label: 'Fidelity Bond / Crime',        dated: true },
  { key: 'ins_workers_comp',      group: 'Insurance',        label: 'Workers’ Compensation',   dated: true },
  { key: 'ins_umbrella',          group: 'Insurance',        label: 'Umbrella / Excess Liability',  dated: true },
  { key: 'ins_flood',             group: 'Insurance',        label: 'Flood',                        dated: true },
  { key: 'ins_cyber',             group: 'Insurance',        label: 'Cyber Liability',              dated: true },
  { key: 'ins_equipment',         group: 'Insurance',        label: 'Equipment Breakdown',          dated: true },
  { key: 'ins_ordinance',         group: 'Insurance',        label: 'Ordinance & Law',              dated: true },
  { key: 'ins_windstorm',         group: 'Insurance',        label: 'Windstorm / Hurricane',        dated: true },

  // Florida-specific safety / structural ─────────────────────────────
  { key: 'sirs',                  group: 'Florida Safety',   label: 'Structural Integrity Reserve Study', dated: true },
  { key: 'wind_mitigation',       group: 'Florida Safety',   label: 'Wind Mitigation Report',       dated: true },
  { key: 'roof_inspection',       group: 'Florida Safety',   label: 'Roof Age / Inspection',        dated: true },
  { key: 'milestone_inspection',  group: 'Florida Safety',   label: 'Milestone Inspection (SB 4-D)',dated: true },

  // Vendors ──────────────────────────────────────────────────────────
  { key: 'vendor_coi',            group: 'Vendors',          label: 'Vendor Certificate of Insurance', dated: true },
  { key: 'vendor_contract',       group: 'Vendors',          label: 'Vendor Contract' },

  // Other ────────────────────────────────────────────────────────────
  { key: 'other',                 group: 'Other',            label: 'Other / Miscellaneous' },
]

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
  created_at:         string
  updated_at:         string
}

/** Returns true when the file's mime + extension suggest we can pull
 *  text out of it via pdf-parse. Conservative — we'd rather mark a
 *  document `unsupported` than try and crash mid-request. */
export function isExtractableMime(mime: string | null | undefined, filename: string | null | undefined): boolean {
  const m = (mime ?? '').toLowerCase()
  const n = (filename ?? '').toLowerCase()
  return m === 'application/pdf' || n.endsWith('.pdf')
}
