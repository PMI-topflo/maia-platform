// =====================================================================
// lib/association-insurance.ts
//
// Canonical Florida HOA / condominium master-insurance checklist plus
// the shared row type + status helpers used by the insurance API
// routes, the admin checklist UI, and the daily compliance cron.
//
// SCOPE: these are the policies the ASSOCIATION carries (master /
// common-element coverage), NOT the per-unit HO-6 policies individual
// owners hold (those live in public.unit_insurance). Per project memory
// this is CINC-side / common-area scope.
//
// The POLICY_TYPES list is the source of truth for which coverages a
// Florida association should be tracking and which are statutorily
// required vs. conditional vs. recommended. `policy_type` is stored as
// free text on the row so this list can grow without a migration.
// =====================================================================

export const INSURANCE_COI_BUCKET = 'association-documents'

/** How strongly a coverage is expected for a Florida association. */
export type RequirementTier = 'required' | 'conditional' | 'recommended'

export interface PolicyTypeDef {
  key:          string
  label:        string
  tier:         RequirementTier
  /** Short plain-English reason / statutory hook shown in the UI. */
  description:  string
  /** For `conditional` coverages — when the policy actually applies. */
  condition?:   string
}

// Order matters: this is the order the checklist renders. Required core
// first, then conditional (depends on the building / employees), then
// recommended best-practice coverages.
export const POLICY_TYPES: PolicyTypeDef[] = [
  {
    key: 'master_property',
    label: 'Master Property / Hazard',
    tier: 'required',
    description:
      'Full replacement-cost coverage of the common elements and building structure. FL §718.111(11) requires adequate property insurance based on replacement cost.',
  },
  {
    key: 'general_liability',
    label: 'Commercial General Liability',
    tier: 'required',
    description:
      'Covers bodily injury / property damage claims arising on common property (slip-and-fall, pool, amenities).',
  },
  {
    key: 'directors_officers',
    label: 'Directors & Officers (D&O)',
    tier: 'required',
    description:
      'Protects individual board members from personal liability for decisions made in their volunteer role. A lapse here is a common board-resignation trigger.',
  },
  {
    key: 'fidelity_crime',
    label: 'Fidelity / Crime Bond',
    tier: 'required',
    description:
      'Bonds anyone who controls or disburses association funds against theft. FL §718.111(11)(h) requires coverage no less than the funds in custody.',
  },
  {
    key: 'flood',
    label: 'Flood',
    tier: 'conditional',
    description:
      'NFIP or private flood coverage for the insured structures.',
    condition: 'Required when any building sits in a FEMA Special Flood Hazard Area (Zone A/V).',
  },
  {
    key: 'windstorm',
    label: 'Windstorm / Hurricane',
    tier: 'conditional',
    description:
      'Named-storm / wind coverage for the structures.',
    condition: 'Required as a standalone policy when wind is excluded from the master property policy — common in coastal South Florida.',
  },
  {
    key: 'workers_comp',
    label: "Workers' Compensation",
    tier: 'conditional',
    description:
      'Covers on-the-job injury to association employees.',
    condition: 'Required under FL §440 when the association has employees (not just contracted vendors).',
  },
  {
    key: 'umbrella',
    label: 'Umbrella / Excess Liability',
    tier: 'recommended',
    description:
      'Sits above the GL and D&O limits for catastrophic claims that exhaust the underlying policies.',
  },
  {
    key: 'equipment_breakdown',
    label: 'Equipment Breakdown (Boiler & Machinery)',
    tier: 'recommended',
    description:
      'Covers mechanical/electrical failure of building systems — elevators, HVAC, pumps, electrical panels.',
  },
  {
    key: 'ordinance_law',
    label: 'Ordinance or Law',
    tier: 'recommended',
    description:
      'Pays the extra cost to rebuild to current code after a covered loss — significant for older Florida buildings.',
  },
  {
    key: 'cyber',
    label: 'Cyber Liability',
    tier: 'recommended',
    description:
      'Covers breach response and liability if owner/resident financial data the association holds is compromised.',
  },
]

export const POLICY_TYPE_KEYS = new Set(POLICY_TYPES.map(p => p.key))

export function policyTypeDef(key: string): PolicyTypeDef | undefined {
  return POLICY_TYPES.find(p => p.key === key)
}

export function policyTypeLabel(key: string): string {
  return policyTypeDef(key)?.label ?? key
}

/** DB row shape for public.association_insurance_policies. */
export interface AssociationInsurancePolicy {
  id:                  number
  association_code:    string
  policy_type:         string
  carrier:             string | null
  policy_number:       string | null
  named_insured:       string | null
  effective_date:      string | null   // YYYY-MM-DD
  expiration_date:     string | null   // YYYY-MM-DD
  coverage_amount_usd: number | null
  premium_usd:         number | null
  agent_name:          string | null
  agent_email:         string | null
  agent_phone:         string | null
  coi_storage_path:    string | null
  coi_filename:        string | null
  coi_mime_type:       string | null
  coi_file_size_bytes: number | null
  waived:              boolean
  waived_reason:       string | null
  notes:               string | null
  archived_at:         string | null
  archived_by_email:   string | null
  created_by_email:    string | null
  created_at:          string
  updated_at:          string
}

/** Computed compliance state for a (policy_type, active row?) pair.
 *  Drives the badge colors in the checklist UI. */
export type PolicyStatus =
  | 'current'        // on file, not expiring soon
  | 'expiring'       // on file, expires within EXPIRY_WARNING_DAYS
  | 'expired'        // on file, expiration_date is in the past
  | 'no_expiry'      // on file but no expiration_date recorded
  | 'waived'         // intentionally not carried
  | 'missing'        // required/conditional, nothing on file
  | 'not_tracked'    // recommended, nothing on file (soft)

/** Days-out at which an expiring policy starts raising a warning.
 *  Matches the 60-day lookahead the compliance cron uses. */
export const EXPIRY_WARNING_DAYS = 60

/** Whole-day delta from today to `dateStr` (negative = past). Computed
 *  with local midnight to match the cron's daysBetween(). */
export function daysUntil(dateStr: string, now: Date = new Date()): number {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

/** Derive the compliance status for one policy type given its current
 *  active row (or null when nothing is on file). `tier` decides whether
 *  an absent policy is `missing` (required/conditional) or merely
 *  `not_tracked` (recommended). */
export function policyStatus(
  tier:   RequirementTier,
  active: AssociationInsurancePolicy | null,
  now:    Date = new Date(),
): PolicyStatus {
  if (active?.waived) return 'waived'
  if (!active) return tier === 'recommended' ? 'not_tracked' : 'missing'
  if (!active.expiration_date) return 'no_expiry'
  const days = daysUntil(active.expiration_date, now)
  if (days < 0) return 'expired'
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring'
  return 'current'
}

/** True when a status should count against the association's compliance
 *  (used for the summary banner: "3 coverages need attention"). */
export function statusNeedsAttention(status: PolicyStatus): boolean {
  return status === 'missing' || status === 'expired' || status === 'expiring'
}
