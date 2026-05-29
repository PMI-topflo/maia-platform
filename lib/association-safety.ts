// =====================================================================
// lib/association-safety.ts
//
// Florida structural-safety inspection checklist + shared row type +
// status / deadline helpers used by the safety API routes, the admin
// checklist UI, and the daily compliance cron / dashboard tracker (I7).
//
// SCOPE: association common-element structural compliance (CINC-side).
// Missed deadlines here carry PERSONAL liability for board members, so
// the tracker errs toward surfacing rather than hiding.
//
// Statutory background (Florida, post-Surfside SB 4-D, 2022; refined by
// SB 154, 2023):
//   • Milestone Inspection — §553.899: condo/coop buildings 3+ stories.
//     Initial at 30 years from CO (25 if within 3 mi of the coastline),
//     then every 10 years. Phase 1 visual; Phase 2 if substantial
//     deterioration found.
//   • SIRS (Structural Integrity Reserve Study) — §718.112(2)(g): condos
//     3+ stories. Must be completed, then updated at least every 10 years.
//   • Wind Mitigation — not a mandate, but the report drives insurance
//     premium credits; carriers treat it as valid ~5 years.
//   • Roof inspection — condition/age tracking; lender + insurer driven.
// =====================================================================

export const SAFETY_REPORT_BUCKET = 'association-documents'

export type SafetyRequirement = 'required_if_3plus' | 'recommended'

export interface InspectionTypeDef {
  key:         string
  label:       string
  requirement: SafetyRequirement
  description: string
  /** Re-inspection cadence in years once a baseline exists. */
  cadenceYears: number
  /** Years from year_built to the FIRST due date (milestone only uses
   *  the coastal split; others fall back to cadence from completion). */
  initialYears?: number
  /** Coastal variant of initialYears (within 3 mi of coast). */
  initialYearsCoastal?: number
}

export const INSPECTION_TYPES: InspectionTypeDef[] = [
  {
    key: 'milestone',
    label: 'Milestone Inspection',
    requirement: 'required_if_3plus',
    description:
      'FL §553.899 structural milestone inspection for condo/coop buildings 3+ stories. Phase 1 by a licensed engineer/architect; Phase 2 if substantial deterioration is found.',
    cadenceYears: 10,
    initialYears: 30,
    initialYearsCoastal: 25,
  },
  {
    key: 'sirs',
    label: 'Structural Integrity Reserve Study (SIRS)',
    requirement: 'required_if_3plus',
    description:
      'FL §718.112(2)(g) reserve study of the structural components (roof, load-bearing walls, foundation, plumbing, electrical, waterproofing, etc.) for condos 3+ stories. Update at least every 10 years.',
    cadenceYears: 10,
  },
  {
    key: 'wind_mitigation',
    label: 'Wind Mitigation Report',
    requirement: 'recommended',
    description:
      'Documents roof shape, deck attachment, and opening protection. Not mandated, but carriers apply premium credits and treat the report as valid for roughly five years.',
    cadenceYears: 5,
  },
  {
    key: 'roof',
    label: 'Roof Inspection',
    requirement: 'recommended',
    description:
      'Roof age + condition assessment. Increasingly required by insurers and lenders before binding or renewing coverage on older roofs.',
    cadenceYears: 5,
  },
]

export const INSPECTION_TYPE_KEYS = new Set(INSPECTION_TYPES.map(t => t.key))

export function inspectionTypeDef(key: string): InspectionTypeDef | undefined {
  return INSPECTION_TYPES.find(t => t.key === key)
}
export function inspectionTypeLabel(key: string): string {
  return inspectionTypeDef(key)?.label ?? key
}

export interface AssociationSafetyInspection {
  id:                     number
  association_code:       string
  inspection_type:        string
  building_label:         string | null
  year_built:             number | null
  stories:                number | null
  coastal:                boolean
  last_completed_date:    string | null   // YYYY-MM-DD
  next_due_date:          string | null
  provider:               string | null
  report_storage_path:    string | null
  report_filename:        string | null
  report_mime_type:       string | null
  report_file_size_bytes: number | null
  /** Google Drive link to the report when the file lives in Drive rather
   *  than uploaded into the system. See COMPLIANCE_TRACKING.md. */
  drive_url:              string | null
  waived:                 boolean
  waived_reason:          string | null
  notes:                  string | null
  archived_at:            string | null
  archived_by_email:      string | null
  created_by_email:       string | null
  created_at:             string
  updated_at:             string
}

export type InspectionStatus =
  | 'scheduled'      // next_due_date in the future, beyond the warning window
  | 'due_soon'       // next_due_date within DUE_WARNING_DAYS
  | 'overdue'        // next_due_date in the past
  | 'completed'      // a row exists, no future deadline tracked
  | 'waived'         // intentionally not carried
  | 'not_required'   // SIRS/milestone but building is < 3 stories
  | 'missing'        // required (3+ stories) but nothing on file
  | 'not_tracked'    // recommended, nothing on file

/** Inspection deadlines move slower than insurance — warn 90 days out. */
export const DUE_WARNING_DAYS = 90

export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

/** Whether a SIRS/Milestone requirement is triggered for a building.
 *  3+ stories triggers; unknown stories is treated as "possibly" so we
 *  don't silently hide a requirement (returns true when stories unknown
 *  for required_if_3plus types). */
export function isApplicable(def: InspectionTypeDef, stories: number | null): boolean {
  if (def.requirement === 'recommended') return true
  if (stories === null) return true            // unknown → surface, don't hide
  return stories >= 3
}

/** Suggested next-due date as YYYY-MM-DD, or null when we can't infer one.
 *  - If a baseline (last_completed_date) exists → add the cadence.
 *  - Else for milestone, compute from year_built + (coastal ? 25 : 30).
 *  - Else null (staff enters it). */
export function suggestedNextDue(
  def:           InspectionTypeDef,
  lastCompleted: string | null,
  yearBuilt:     number | null,
  coastal:       boolean,
): string | null {
  if (lastCompleted && /^\d{4}-\d{2}-\d{2}$/.test(lastCompleted)) {
    const d = new Date(lastCompleted)
    d.setFullYear(d.getFullYear() + def.cadenceYears)
    return d.toISOString().slice(0, 10)
  }
  if (def.initialYears && yearBuilt && yearBuilt > 1800) {
    const firstDueYear = yearBuilt + (coastal && def.initialYearsCoastal ? def.initialYearsCoastal : def.initialYears)
    return `${firstDueYear}-12-31`
  }
  return null
}

/** Derive the compliance status for one inspection type given its active
 *  row (or null) and the building's story count. */
export function inspectionStatus(
  def:     InspectionTypeDef,
  active:  AssociationSafetyInspection | null,
  stories: number | null,
  now:     Date = new Date(),
): InspectionStatus {
  if (active?.waived) return 'waived'
  const applies = isApplicable(def, active?.stories ?? stories)
  if (!active) {
    if (!applies) return 'not_required'
    return def.requirement === 'recommended' ? 'not_tracked' : 'missing'
  }
  if (!applies) return 'not_required'
  if (!active.next_due_date) return 'completed'
  const days = daysUntil(active.next_due_date, now)
  if (days < 0) return 'overdue'
  if (days <= DUE_WARNING_DAYS) return 'due_soon'
  return 'scheduled'
}

export function statusNeedsAttention(s: InspectionStatus): boolean {
  return s === 'missing' || s === 'overdue' || s === 'due_soon'
}
