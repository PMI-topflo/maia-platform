// =====================================================================
// lib/onboarding-catalog.ts
//
// The question catalog for the association onboarding questionnaire —
// APPLICATIONS scope (user direction, 2026-09-09: "start implementing the
// application process for all associations first, then expanding to all
// items of the compliance"). Compliance / operations / residents sections
// are added here later as more entries, not as a new mechanism.
//
// One entry per question. Each entry names the LIVE setting the answer is
// written to on adoption (see lib/onboarding.ts → applyDecision). Adding a
// question is one entry here plus one branch in applyDecision — never a
// migration, unless the live target itself is new.
//
// Two kinds of item:
//   fact: true  — identity facts (legal name, type, address). Staff confirm
//                 them; stamped, but not a board decision.
//   fact: false — a board decision. Recorded with the board member who
//                 decided, the source (meeting vote / email consent) and
//                 the date; applied only on adoption.
//
// Checklist cells (checklist.<type>.<doc_key>) are dynamic — they come from
// the association's own association_intake_documents rows — so they are
// not listed here. isChecklistKey() recognises them.
// =====================================================================

export type OnboardingSection = 'identity' | 'applications' | 'rules' | 'checklist' | 'board'

export const SECTIONS: { key: OnboardingSection; number: number; title: string; blurb: string; facts?: boolean }[] = [
  { key: 'identity',     number: 1, title: 'Identity & legal',        blurb: 'The fields the Association Hub flags as "setup fields missing", plus the legal name used on letters. Facts, confirmed by staff.', facts: true },
  { key: 'applications', number: 2, title: 'Applications & screening', blurb: 'Whether MAIA runs applications for this association, how applicants are screened, and whether an interview comes before the approval letter.' },
  { key: 'rules',        number: 3, title: 'Eligibility rules',        blurb: 'The rules MAIA enforces or flags on every application. "Block" stops the applicant; "Warn" flags it for the board to check.' },
  { key: 'checklist',    number: 4, title: 'Document checklist',       blurb: 'Which documents each application type collects. Required, optional, or off — per document, per type.' },
  { key: 'board',        number: 5, title: 'Board & approvals',        blurb: 'Who approves applications, how many signatures close a decision, how long the board has, and how MAIA reminds them.' },
]

export type ItemKind = 'boolean' | 'number' | 'select' | 'text' | 'rule' | 'committee'

export interface CatalogItem {
  key: string
  section: OnboardingSection
  label: string
  help?: string
  kind: ItemKind
  /** For 'select'. */
  options?: { value: string; label: string }[]
  /** For 'number' and numeric 'rule' — printed after the input. */
  suffix?: string
  /** For 'rule': whether the rule carries a number (min lease days) or is a plain yes/no. */
  ruleNumeric?: boolean
  /** For 'rule': the association_application_rules.label written on apply; {value} is interpolated. */
  ruleLabel?: string
  fact?: boolean
  /** Plain-English description of the live setting written on adoption. */
  target: string
}

export const CATALOG: CatalogItem[] = [
  // ── 1 · Identity & legal (facts) ─────────────────────────────────
  { key: 'identity.legal_name', section: 'identity', fact: true, kind: 'text', label: 'Legal entity name', help: 'Exactly as recorded with Sunbiz. Appears on approval letters and lease packets.', target: 'associations.legal_name' },
  { key: 'identity.association_type', section: 'identity', fact: true, kind: 'select', label: 'Association type', help: 'Sets the Florida statute chapter, the board-certification regime (condo / co-op: 7-year certificate; HOA: 4-year), and the unit insurance type MAIA asks for.',
    options: [
      { value: 'condo', label: 'Condominium (Chapter 718)' },
      { value: 'coop', label: 'Cooperative (Chapter 719)' },
      { value: 'hoa', label: 'Homeowners’ association (Chapter 720)' },
      { value: 'commercial_condo', label: 'Commercial condominium (Chapter 718)' },
      { value: 'master_hoa', label: 'Master association (Chapter 720)' },
    ], target: 'associations.association_type + florida_statute' },
  { key: 'identity.service_type', section: 'identity', fact: true, kind: 'select', label: 'PMI service level', help: 'Bookkeeping-only associations skip work orders, vendors and on-site sections later.',
    options: [{ value: 'full management', label: 'Full management' }, { value: 'bookkeeping', label: 'Bookkeeping' }], target: 'associations.service_type' },
  { key: 'identity.principal_address', section: 'identity', fact: true, kind: 'text', label: 'Principal address (street)', target: 'associations.principal_address' },
  { key: 'identity.city', section: 'identity', fact: true, kind: 'text', label: 'City', help: 'Lauderhill requires a yearly Certificate of Use for leased units; MAIA uses the city to know whether to ask for it.', target: 'associations.city' },
  { key: 'identity.state', section: 'identity', fact: true, kind: 'text', label: 'State', target: 'associations.state' },
  { key: 'identity.zip', section: 'identity', fact: true, kind: 'text', label: 'ZIP', target: 'associations.zip' },
  { key: 'identity.sunbiz_document_number', section: 'identity', fact: true, kind: 'text', label: 'Sunbiz document number', help: 'Needed for the May 1 annual-report tracker.', target: 'associations.sunbiz_document_number' },
  { key: 'identity.fei_ein_number', section: 'identity', fact: true, kind: 'text', label: 'FEI / EIN number', target: 'associations.fei_ein_number' },

  // ── 2 · Applications & screening ─────────────────────────────────
  { key: 'apps.enabled', section: 'applications', kind: 'boolean', label: 'Run sale and lease applications through MAIA?', help: 'Turns on the pre-apply intake, document collection, board review and decision letters. "No" hides the application forms from the resident portal.', target: 'association_config.hide_application_forms (inverted)' },
  { key: 'apps.screening_provider', section: 'applications', kind: 'select', label: 'Background & credit screening provider', help: 'Checkr via MAIA: $150 per adult, collected by MAIA before the order. Tenant Evaluation: the applicant pays the vendor directly.',
    options: [{ value: 'maia_checkr', label: 'Checkr via MAIA' }, { value: 'tenant_evaluation', label: 'Tenant Evaluation' }], target: 'associations.screening_provider' },
  { key: 'apps.interview_lease', section: 'applications', kind: 'boolean', label: 'Require an interview before the approval letter — leases?', help: 'MAIA holds the letter and sends an interview-scheduling email instead. Only affects future applications.', target: 'associations.requires_interview_lease' },
  { key: 'apps.interview_purchase', section: 'applications', kind: 'boolean', label: 'Require an interview before the approval letter — purchases?', target: 'associations.requires_interview_purchase' },

  // ── 3 · Eligibility rules → association_application_rules ────────
  { key: 'rules.individuals_only', section: 'rules', kind: 'rule', label: 'Individuals only — no LLC, trust or corporate purchasers', ruleLabel: 'Individuals only — no LLC, trust or corporate purchasers', target: 'association_application_rules.individuals_only' },
  { key: 'rules.min_lease_days', section: 'rules', kind: 'rule', ruleNumeric: true, suffix: 'days', label: 'Minimum lease term', ruleLabel: 'Minimum lease term is {value} days', target: 'association_application_rules.min_lease_days' },
  { key: 'rules.max_rentals_per_12mo', section: 'rules', kind: 'rule', ruleNumeric: true, suffix: 'per 12 months', label: 'Maximum rentals per 12 months', ruleLabel: 'A unit may be rented at most {value} time(s) in any 12 months', target: 'association_application_rules.max_rentals_per_12mo' },
  { key: 'rules.no_rent_years_after_purchase', section: 'rules', kind: 'rule', ruleNumeric: true, suffix: 'years', label: 'Waiting period before a new owner may rent', ruleLabel: 'An owner may not rent out the unit for the first {value} year(s) after purchase', target: 'association_application_rules.no_rent_years_after_purchase' },
  { key: 'rules.no_short_term_rental', section: 'rules', kind: 'rule', label: 'No short-term rentals (Airbnb, Vrbo and similar)', ruleLabel: 'No short-term rentals (Airbnb, Vrbo and similar)', target: 'association_application_rules.no_short_term_rental' },
  { key: 'rules.max_rented_pct', section: 'rules', kind: 'rule', ruleNumeric: true, suffix: '% of units', label: 'Maximum share of units leased at any one time', ruleLabel: 'No more than {value}% of units may be leased at any one time', target: 'association_application_rules.max_rented_pct' },
  { key: 'rules.no_for_sale_sign', section: 'rules', kind: 'rule', label: 'No "For Sale" sign on the property', ruleLabel: 'No "For Sale" sign on the property', target: 'association_application_rules.no_for_sale_sign' },

  // ── 5 · Board & approvals ────────────────────────────────────────
  { key: 'board.required_signatures', section: 'board', kind: 'select', label: 'Signatures required to approve an application', help: 'A Decider’s signature counts toward this number; a Voter’s is recorded but advisory.',
    options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }], target: 'board_approval_config.required_signatures (application)' },
  { key: 'board.committee', section: 'board', kind: 'committee', label: 'Who is on the application committee?', help: 'Deciders sign the approval; Voters are asked but their answer is advisory.', target: 'board_approval_members (application)' },
  { key: 'board.decision_window_days', section: 'board', kind: 'number', suffix: 'calendar days', label: 'Board decision window', help: 'Days from a complete application to a decision, as the Declaration states it. Applies to new applications. Venetian Park I’s 10 business days stays as its own code rule.', target: 'board_approval_config.decision_window_days' },
  { key: 'board.reminder_cadence', section: 'board', kind: 'select', label: 'Remind board members who haven’t signed',
    options: [{ value: 'every_2_days', label: 'Every 2 days' }, { value: 'every_3_days', label: 'Every 3 days' }, { value: 'weekly', label: 'Weekly' }, { value: 'off', label: 'Off' }], target: 'board_approval_config.reminder_cadence' },
]

const BY_KEY = new Map(CATALOG.map(i => [i.key, i]))

export function catalogItem(key: string): CatalogItem | null {
  return BY_KEY.get(key) ?? null
}

export const CHECKLIST_KEY_RE = /^checklist\.(lease|purchase|additional_occupant|lease_renewal)\.([a-z0-9_]+)$/

export function isChecklistKey(key: string): boolean {
  return CHECKLIST_KEY_RE.test(key)
}

export type ChecklistState = 'required' | 'optional' | 'off'
export const CHECKLIST_STATES: ChecklistState[] = ['required', 'optional', 'off']

/** True for items staff confirm rather than the board decides. */
export function isFactKey(key: string): boolean {
  return BY_KEY.get(key)?.fact === true
}

export function sectionOf(key: string): OnboardingSection | null {
  if (isChecklistKey(key)) return 'checklist'
  return BY_KEY.get(key)?.section ?? null
}

/** Statute chapter that follows from the association type. */
export function statuteFor(type: string | null): string | null {
  switch (type) {
    case 'condo': case 'commercial_condo': return 'Chapter 718'
    case 'coop': return 'Chapter 719'
    case 'hoa': case 'master_hoa': return 'Chapter 720'
    default: return null
  }
}

export const SOURCE_LABEL: Record<string, string> = {
  meeting: 'Board meeting',
  email_consent: 'Board email consent',
  staff_confirmed: 'Confirmed by staff',
  existing_config: 'Existing configuration',
}
