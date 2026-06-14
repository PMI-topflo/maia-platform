// =====================================================================
// lib/compliance-taxonomy.ts
//
// The canonical compliance catalog for PMI Top Florida Properties —
// association-level and unit/owner-level. Pure data + helpers (no server
// imports), so it's safe in the browser. Per (association[, unit]) the
// stored compliance_records say which items APPLY and their STATUS; this
// catalog is the master list everything is measured against.
// =====================================================================

export type ComplianceScope = 'association' | 'unit'
export type ComplianceStatus = 'current' | 'expiring' | 'pending' | 'missing' | 'non_compliant' | 'na'

export const STATUS_LABEL: Record<ComplianceStatus, string> = {
  current: 'Current', expiring: 'Expiring soon', pending: 'Pending renewal',
  missing: 'Missing', non_compliant: 'Non-compliant', na: 'N/A',
}
export const STATUS_STYLE: Record<ComplianceStatus, string> = {
  current: 'bg-emerald-100 text-emerald-800', expiring: 'bg-amber-100 text-amber-800',
  pending: 'bg-amber-100 text-amber-800', missing: 'bg-red-100 text-red-800',
  non_compliant: 'bg-red-100 text-red-800', na: 'bg-gray-100 text-gray-500',
}
export const SETTABLE_STATUSES: ComplianceStatus[] = ['current', 'expiring', 'pending', 'missing', 'non_compliant']

export interface ComplianceItem { key: string; label: string; expiry?: boolean }
export interface ComplianceCategory { key: string; label: string; scope: ComplianceScope; items: ComplianceItem[] }

// Helper: [slug, label, expiry?] → ComplianceItem (key namespaced by category).
const it = (cat: string, rows: [string, string, boolean?][]): ComplianceItem[] =>
  rows.map(([s, label, expiry]) => ({ key: `${cat}.${s}`, label, expiry: !!expiry }))

export const COMPLIANCE_TAXONOMY: ComplianceCategory[] = [
  // ── Association scope ────────────────────────────────────────────
  { key: 'sunbiz', label: 'Sunbiz', scope: 'association', items: it('sunbiz', [
    ['annual_report', 'Annual Report Filing', true], ['corporate_status', 'Corporate Status'],
    ['registered_agent', 'Registered Agent'], ['directors_officers', 'Directors and Officers'],
    ['corporate_address', 'Corporate Address'], ['fein', 'FEIN/EIN Information'],
    ['articles', 'Articles of Incorporation'], ['amendments', 'Amendments to Articles'],
  ]) },
  { key: 'insurance', label: 'Insurance', scope: 'association', items: it('insurance', [
    ['property', 'Property Insurance', true], ['general_liability', 'General Liability', true],
    ['do', 'Directors & Officers (D&O)', true], ['fidelity', 'Fidelity/Crime Coverage', true],
    ['workers_comp', 'Workers Compensation', true], ['umbrella', 'Umbrella/Excess Liability', true],
    ['flood', 'Flood Insurance', true], ['windstorm', 'Windstorm Coverage', true],
    ['equipment', 'Equipment Breakdown', true], ['cyber', 'Cyber Liability', true],
    ['coi', 'Certificates of Insurance (COI)', true], ['appraisal', 'Insurance Appraisal'],
    ['claims', 'Claims History'], ['limits', 'Coverage Limits Review'], ['deductible', 'Deductible Review'],
  ]) },
  { key: 'dbpr', label: 'DBPR', scope: 'association', items: it('dbpr', [
    ['annual_report', 'Annual Association Report', true], ['registration', 'Association Registration'],
    ['mgmt_registration', 'Management Company Registration'], ['board_certs', 'Board Member Certifications'],
    ['continuing_ed', 'Continuing Education Records'], ['gov_docs_filed', 'Governing Documents Filed'],
    ['election_records', 'Election Records'], ['official_records', 'Official Records Compliance'],
  ]) },
  { key: 'tax', label: 'Tax Filing', scope: 'association', items: it('tax', [
    ['form_1120h', 'IRS Form 1120-H', true], ['form_1120', 'IRS Form 1120', true],
    ['w9', 'W-9 Forms'], ['form_1099', '1099 Forms', true], ['form_1096', '1096 Filing', true],
    ['ein_letter', 'EIN Confirmation Letter'], ['irs_notices', 'IRS Notices'], ['exemption', 'Tax Exemption Documentation'],
  ]) },
  { key: 'audit', label: 'Audit', scope: 'association', items: it('audit', [
    ['annual_audit', 'Annual Audit', true], ['financial_review', 'Financial Review'],
    ['compilation', 'Compilation Report'], ['engagement', 'Auditor Engagement Letter'],
    ['mgmt_rep', 'Management Representation Letter'], ['internal_control', 'Internal Control Recommendations'],
    ['findings', 'Audit Findings/Corrective Actions'],
  ]) },
  { key: 'sirs', label: 'SIRS', scope: 'association', items: it('sirs', [
    ['report', 'Current SIRS Report', true], ['funding_schedule', 'Reserve Funding Schedule'],
    ['inventory', 'Reserve Component Inventory'], ['useful_life', 'Useful Life Estimates'],
    ['remaining_life', 'Remaining Useful Life Estimates'], ['funding_plan', 'Funding Plan'],
    ['engineer_report', 'Engineer/Reserve Specialist Report'], ['board_adoption', 'Board Adoption Documentation'],
  ]) },
  { key: 'milestone', label: 'Milestone Inspection', scope: 'association', items: it('milestone', [
    ['phase1', 'Phase 1 Inspection Report', true], ['phase2', 'Phase 2 Inspection Report', true],
    ['structural', 'Structural Engineer Report'], ['repair_recs', 'Repair Recommendations'],
    ['repair_completion', 'Repair Completion Reports'], ['filings', 'Local Government Filings'],
    ['engineer_certs', 'Engineer Certifications'], ['followup', 'Follow-Up Inspection Reports'],
    ['recertification', 'Municipal Recertification Report', true], ['building_condition', 'Building Condition Report'],
  ]) },
  { key: 'fire', label: 'Fire Compliance', scope: 'association', items: it('fire', [
    ['alarm', 'Fire Alarm Inspection', true], ['sprinkler', 'Sprinkler Inspection', true],
    ['extinguisher', 'Fire Extinguisher Inspection', true], ['backflow', 'Backflow Prevention Testing', true],
    ['pump', 'Fire Pump Inspection', true], ['emergency_lighting', 'Emergency Lighting Inspection', true],
    ['exit_sign', 'Exit Sign Inspection', true], ['marshal', 'Fire Marshal Reports'],
    ['certifications', 'Fire Safety Certifications', true], ['elevator_fire', 'Elevator Fire Service Inspection', true],
  ]) },
  { key: 'vendor', label: 'Vendor Compliance', scope: 'association', items: it('vendor', [
    ['coi', 'Certificate of Insurance (COI)', true], ['general_liability', 'General Liability Insurance', true],
    ['workers_comp', 'Workers Compensation Insurance', true], ['auto', 'Auto Liability Insurance', true],
    ['licenses', 'Professional Licenses', true], ['btr', 'Business Tax Receipt', true],
    ['w9', 'W-9 Form'], ['contract', 'Vendor Contract', true], ['background', 'Background Checks (if required)'],
  ]) },
  { key: 'board_certs', label: 'Board Certifications', scope: 'association', items: it('board_certs', [
    ['cert_forms', 'Board Member Certification Forms'], ['continuing_ed', 'Continuing Education Certificates'],
    ['ethics', 'Ethics Training Records'], ['director_appt', 'Director Appointment Records'],
    ['officer_appt', 'Officer Appointment Records'], ['roster', 'Board Roster'], ['conflict', 'Conflict of Interest Disclosures'],
  ]) },
  { key: 'contracts', label: 'Contracts', scope: 'association', items: it('contracts', [
    ['landscaping', 'Landscaping', true], ['pool', 'Pool Service', true], ['janitorial', 'Janitorial', true],
    ['security', 'Security', true], ['pest', 'Pest Control', true], ['elevator', 'Elevator Maintenance', true],
    ['hvac', 'HVAC Maintenance', true], ['fire_protection', 'Fire Protection', true], ['waste', 'Waste Management', true],
    ['management', 'Management Agreement', true], ['legal', 'Legal Services Agreement', true],
    ['cpa', 'CPA/Audit Agreement', true], ['engineering', 'Engineering Agreements'], ['reserve_study', 'Reserve Study Agreements'],
    ['technology', 'Technology/Software Agreements', true],
  ]) },
  { key: 'governing', label: 'Governing Documents', scope: 'association', items: it('governing', [
    ['declaration', 'Declaration / Covenants'], ['articles', 'Articles of Incorporation'], ['bylaws', 'Bylaws'],
    ['rules', 'Rules & Regulations'], ['collection_policy', 'Collection Policy'], ['fine_policy', 'Fine Policy'],
    ['arc', 'Architectural Review Guidelines'], ['parking', 'Parking Policy'], ['leasing', 'Leasing Policy'],
    ['records_inspection', 'Records Inspection Policy'], ['investment', 'Investment Policy'], ['enforcement', 'Enforcement Policy'],
    ['resolutions', 'Board Resolutions'], ['amendments', 'Recorded Amendments'],
  ]) },
  { key: 'licenses', label: 'Licenses & Permits', scope: 'association', items: it('licenses', [
    ['pool', 'Pool Operating Permit / License', true], ['elevator', 'Elevator Operating Certificate', true],
    ['btr', 'Business Tax Receipt (BTR)', true], ['boiler', 'Boiler Certificate', true],
    ['generator', 'Generator / Fuel Permit', true], ['signage', 'Signage Permit'],
    ['other', 'Other State / County Permit', true],
  ]) },
  { key: 'meetings', label: 'Meetings', scope: 'association', items: it('meetings', [
    ['annual_minutes', 'Annual Meeting Minutes', true], ['board_minutes', 'Board Meeting Minutes', true],
    ['organizational_minutes', 'Organizational Meeting Minutes'], ['budget_minutes', 'Budget Meeting Minutes'],
    ['election_minutes', 'Election Meeting Minutes'], ['notices', 'Meeting Notices & Agendas'],
  ]) },
  { key: 'risk', label: 'Risk Management', scope: 'association', items: it('risk', [
    ['emergency_plan', 'Emergency / Hurricane Preparedness Plan'], ['claims_log', 'Insurance Claims Log'],
    ['incident_reports', 'Incident Reports'], ['disaster_recovery', 'Disaster Recovery Plan'],
  ]) },

  // ── Unit / owner scope (the "Gold Standard" 15 registrations) ─────
  { key: 'unit', label: 'Owner Compliance', scope: 'unit', items: it('unit', [
    ['ownership', 'Ownership Verification'], ['contact', 'Contact Information'], ['emergency', 'Emergency Contact'],
    ['unit_manager', 'Unit Manager Info'], ['occupancy', 'Occupancy Registration'],
    ['tenant', 'Tenant Registration & Contact', true], ['vehicle', 'Vehicle Registration'], ['pet', 'Pet Registration'],
    ['ho6', 'HO-6 Owners Insurance', true], ['ho4', 'HO-4 Renters Insurance (if leased)', true],
    ['entity_docs', 'LLC / Trust Documents'], ['usage_type', 'Unit Usage Type (commercial)'],
    ['access', 'Access Control'], ['architectural', 'Architectural (ARC) Requests/Approvals'],
    ['contractor', 'Contractor Records'], ['move', 'Move-In/Out Records'],
    ['rules_ack', 'Governing Documents Acknowledgement'], ['leasing', 'Lease Agreement', true], ['violations', 'Violation History'],
  ]) },
]

export function categoriesForScope(scope: ComplianceScope): ComplianceCategory[] {
  return COMPLIANCE_TAXONOMY.filter(c => c.scope === scope)
}

export interface ComplianceRecord { item_key: string; applicable: boolean; status: ComplianceStatus; expiry_date: string | null; notes: string | null }

/** Compliance % for a set of items given the stored records. Counts only
 *  APPLICABLE items; "current" = compliant, partial credit for expiring/
 *  pending, zero for missing/non-compliant. Returns null if nothing applies. */
export function scoreFor(items: ComplianceItem[], byKey: Map<string, ComplianceRecord>): { pct: number | null; applicable: number; current: number } {
  let applicable = 0, points = 0, current = 0
  for (const i of items) {
    const r = byKey.get(i.key)
    const isApplicable = r ? r.applicable : true   // default: applies
    if (!isApplicable) continue
    applicable++
    const status: ComplianceStatus = r?.status ?? 'missing'
    if (status === 'current') { points += 1; current++ }
    else if (status === 'expiring' || status === 'pending') points += 0.5
  }
  return { pct: applicable === 0 ? null : Math.round((points / applicable) * 100), applicable, current }
}
