// =====================================================================
// lib/vpci-application-guide.ts
//
// Venetian Park Condominium I's downloadable Application Guide — the
// narrative content with no home in a table (masthead, process steps, the
// post-approval items, the footer), plus the map that groups this
// association's association_application_rules rows into the guide's
// sections. The rules themselves and the document checklist are read LIVE
// by lib/application-guide-data.ts, so the guide never shows a rule or
// checklist item that was changed or retired after this file was written.
//
// Sources: the association's own packet (Rules & Regulations revised
// 4/7/2022; Declaration Article XXII) as already transcribed for the Rules
// Knowledge Acknowledgment in lib/vpci-rules-ack.ts, and the Board's
// 2026-08-25 clarification (no trust purchases). Second association after
// MANXI (lib/manxi-application-guide.ts), 2026-09-11.
// =====================================================================

import type { GuideMasthead, GuideNote, GuideStep, GuideRegistration } from '@/lib/manxi-application-guide'

export const VPCI_GUIDE_MASTHEAD: GuideMasthead = {
  legalName: 'Venetian Park Condominium I Association, Inc.',
  address: '801 NE 25th Avenue, Hallandale Beach, FL 33009',
  statute: 'Florida Statute Chapter 718',
  dek: 'Everything a buyer, tenant, agent, or additional occupant needs to know before starting an application.',
}

// rule_key → which §1 group it prints under. A live rule with no entry here
// still prints, under "Other", so a rule added later is never dropped.
export const VPCI_RULE_GROUPS: Record<string, 'all' | 'lease' | 'purchase' | 'international'> = {
  no_for_sale_sign: 'all',
  individuals_only: 'purchase',
  no_trust_purchase: 'purchase',
  no_rent_years_after_purchase: 'purchase',
  min_lease_days: 'lease',
  max_rentals_per_12mo: 'lease',
  no_short_term_rental: 'lease',
  max_rented_pct: 'lease',
}

// Policy statements from the packet that are not enforceable rule rows but
// belong in the same section.
export const VPCI_GUIDE_NOTES: GuideNote[] = [
  { group: 'all', text: 'The Association holds a Right of First Refusal on any sale, lease, or transfer, on the same terms offered to a third party.' },
  { group: 'all', text: 'Every person who will occupy the unit must be screened, and every occupant 18 or over must be approved by the Board.' },
  { group: 'all', text: 'A personal interview with the Board is required before approval is granted. Occupancy before the Board\'s written approval is prohibited.' },
  { group: 'all', text: 'Maximum two (2) vehicles per unit. RVs, campers, boats, trailers, oversized vans and commercial vehicles are not permitted on the property.' },
  { group: 'lease', text: 'A unit may only be leased as a whole. Room rentals are not permitted.' },
  { group: 'lease', text: 'A rented unit must provide proof of liability and renter\'s insurance to the Association every year.' },
  { group: 'purchase', text: 'A signed bona fide purchase contract must be submitted at least thirty (30) days before the expected date of occupancy.' },
]

export const VPCI_GUIDE_STEPS: GuideStep[] = [
  {
    title: 'Start your application & confirm your unit',
    body: "Filed through MAIA's secure portal. You'll identify yourself, confirm the unit, and review the full document checklist for your application type before anything else. Submit the proposed lease or purchase agreement at least 30 days before the expected date of occupancy.",
  },
  {
    title: 'Pay & consent to your background/credit check',
    body: "A one-time application fee is paid securely through MAIA's own checkout; each adult applicant (including a co-applicant or adult occupant) pays their own. The background/credit check starts automatically the moment payment clears; you'll get a separate email with a short consent step to complete it.",
  },
  {
    title: 'Upload the required documents',
    body: "Each applicant gets a personal upload link. See the checklist below for exactly what's needed for your application type. This runs in parallel with your background check, not after it.",
  },
  { title: 'Sign the Rules Knowledge Acknowledgment', body: 'Every person who will occupy the unit signs the Association\'s Rules & Regulations acknowledgment electronically inside MAIA. No paper form is mailed.' },
  { title: 'Staff review', body: 'PMI checks every document against the checklist and flags anything missing or expired before it reaches the Board.' },
  { title: 'Board review & interview', body: 'Per the Declaration (Article XXII), the Board must approve or disapprove the application in writing within ten (10) business days of receiving the complete application and any additional information it requests. A personal interview with the Board is required before approval; PMI schedules it once every document is approved.' },
  { title: 'Approval letter', body: 'Issued electronically once approved and signed by the Association\'s officers. The unit may not be occupied before this written approval is received.' },
  { title: 'Estoppel & resale documents — purchases only', body: 'After approval, estoppel letters are requested through www.condocerts.com. The Association\'s approval is recorded in the Public Records of Broward County at the purchaser\'s expense.' },
]

export const VPCI_GUIDE_RENEWAL_NOTE =
  'Renewing a lease? The Association must be notified and given a copy of the newly executed lease before the current one expires. When a lease ends, the Association must be told the unit\'s status, and any new lease must be presented for approval.'

export const VPCI_GUIDE_AFTER_APPROVAL: GuideRegistration[] = [
  { title: 'Move-in', body: 'Only after the Board\'s written approval letter is received. Occupancy before that is prohibited and renders the purchase or lease void.' },
  { title: 'Vehicles', body: 'Register up to two (2) vehicles per unit with the Association. Commercial and recreational vehicles are not permitted on the property.' },
  { title: 'Renter\'s insurance — leases', body: 'Proof of liability and renter\'s insurance is provided to the Association every year for as long as the unit is rented.' },
  { title: 'Estoppel letter — purchases', body: 'Requested through www.condocerts.com after approval, for closing.' },
]

export const VPCI_GUIDE_FOOTER =
  'Prepared by PMI Top Florida Properties for Venetian Park Condominium I Association, Inc. Requirements reflect the Association\'s current governing documents and Board policy at the time this PDF was generated, and are subject to change without notice.'
