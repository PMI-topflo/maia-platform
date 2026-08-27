// =====================================================================
// lib/manxi-application-guide.ts
//
// The Manors of Inverrary XI's downloadable Application Guide — the
// narrative content that has no home in a table (masthead, process steps,
// the fee schedule, the post-approval registrations, the footer note), plus
// the map that groups association_application_rules rows into the guide's
// three sections. The rules themselves and the document checklist are NOT
// duplicated here — lib/application-guide-data.ts reads those live, the same
// way the staff Required Documents panel does, so the guide can never show a
// rule or checklist item that's been changed or retired since this file was
// last edited.
//
// MANXI-only for now. A future association gets its own file of this shape
// (see lib/vpci-rules-ack.ts for the equivalent Rules Knowledge Ack pattern)
// and a new entry in GUIDE_CONTENT (lib/application-guide-data.ts).
// =====================================================================

export interface GuideMasthead {
  legalName: string
  address: string
  statute: string
  dek: string
}

export const MANXI_GUIDE_MASTHEAD: GuideMasthead = {
  legalName: 'The Manors of Inverrary XI Condominium Association, Inc.',
  address: '4174 Inverrary Drive, Lauderhill, FL 33319',
  statute: 'Florida Statute Chapter 718',
  dek: 'Everything a buyer, tenant, agent, or additional occupant needs to know before starting an application.',
}

// rule_key → which §1 group it prints under. A live rule with no entry here
// still prints, under "Other" — so a newly-added rule is never silently
// dropped from the guide just because this map wasn't updated the same day.
export const MANXI_RULE_GROUPS: Record<string, 'all' | 'lease' | 'purchase'> = {
  no_pet: 'all',
  max_occupants_by_bedrooms: 'all',
  no_commercial_or_recreational_vehicles: 'all',
  no_lease_if_delinquent: 'lease',
  no_trust_purchase: 'purchase',
  individuals_only: 'purchase',
  no_rent_years_after_purchase: 'purchase',
  max_rentals_per_12mo: 'purchase',
  min_annual_income: 'purchase',
  credit_score_advance_maintenance: 'purchase',
}

export interface GuideNote { group: 'all' | 'lease' | 'purchase'; text: string }

// Policy statements that aren't formal association_application_rules rows
// (nothing to enforce/block against) but belong in the same section.
export const MANXI_GUIDE_NOTES: GuideNote[] = [
  { group: 'lease', text: 'The unit must carry a current City of Lauderhill Certificate of Use, renewed annually each September.' },
  { group: 'purchase', text: 'A board interview is required before the approval letter is issued.' },
]

export interface GuideStep { title: string; body: string }

export const MANXI_GUIDE_STEPS: GuideStep[] = [
  {
    // Corrected 2026-08-27: this used to describe a single MAIA-collected fee
    // covering processing + the background check. That isn't real yet — MAIA
    // collects nothing today; the applicant pays and completes the check
    // directly on Tenant Evaluation's own site, using the property code MAIA
    // gives them. Don't restore the "$150/$300, filed through MAIA's portal"
    // framing until MAIA actually collects a payment for the new (listing_
    // applications) flow — that logic exists only in the old, unused
    // ApplicationForm.tsx / applications-table system today.
    title: 'Submit the application',
    body: 'Filed through MAIA\'s secure portal. Each applicant then completes the background/credit check directly on Tenant Evaluation\'s own site, using the property code MAIA provides — that check, and its fee, are handled entirely by Tenant Evaluation, not MAIA.',
  },
  {
    title: 'Upload the required documents',
    body: "Each applicant gets a personal upload link — see the checklist below for exactly what's needed for your application type.",
  },
  { title: 'Staff review', body: 'PMI checks every document against the checklist and flags anything missing or expired before it reaches the Board.' },
  { title: 'Board review', body: 'The Board has up to 30 days to decide, starting once the last required document has been received and reviewed.' },
  { title: 'Board interview — purchases only', body: 'Required before the approval letter is issued. PMI schedules this once every document is approved.' },
  { title: 'Approval letter', body: 'Issued electronically once approved, signed by 2 board members. The unit may not be occupied before this is received.' },
  { title: 'Order resale & lender documents — purchases only', body: 'After approval, the owner requests the Resale Demand, Lender Questionnaire, and Association Documents online at HomeWiseDocs.com.' },
]

export const MANXI_GUIDE_RENEWAL_NOTE =
  'Renewing a lease? Submit the renewal at least 30 days before the current lease expires — late renewals risk a gap with no lease on file.'

export interface GuideRegistration { title: string; body: string }

export const MANXI_GUIDE_AFTER_APPROVAL: GuideRegistration[] = [
  { title: 'Front Gate Entry Barcode', body: 'Vehicle registration + driver\'s license + $5 (cash).' },
  { title: 'Manors Club I.D. Card', body: 'Required for the pools, gym, and basketball court. Government ID + $5 (cash).' },
  { title: 'Proximity Card', body: 'Required to reserve the pool deck or event hall. $10 first card, $25 each additional (cash).' },
  { title: 'Elevator / Gate Pass', body: 'For move-in — submit at least 3 business days ahead. $40 non-refundable (money order).' },
]

export const MANXI_GUIDE_FOOTER =
  'Prepared by PMI Top Florida Properties for The Manors of Inverrary XI Condominium Association, Inc. Requirements reflect the Association\'s current governing documents and Board policy at the time this PDF was generated, and are subject to change without notice.'
