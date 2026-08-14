// =====================================================================
// lib/vpci-rules-ack.ts
//
// Venetian Park Condominium I's Rules Knowledge Acknowledgment content, lifted
// from the association's own packet (Rules & Regulations revised 4/7/22, plus
// the Board's 09/23/2020 and 10/07/2020 adopted changes).
//
// TWO INSTRUCTIONS FROM THE PAPER FORM ARE DELIBERATELY GONE:
//   - "…must be completed, signed, and sent to support@pmitop.com" — MAIA
//     collects the documents through the application, so telling the applicant
//     to email a signed packet sends them somewhere that no longer applies.
//   - "Complete the application and background-check screening online at
//     topfloridaproperties.com → Association Application (or the Rentvine
//     link)" — MAIA orders the background check itself.
// The remaining four are renumbered.
//
// The signature block is likewise gone: four Name/Signature/Date rules and a
// "___ has been screened on ___" line, replaced by MAIA's verified electronic
// signatures (see lib/esign-forms.tsx `rules_knowledge_ack`).
// =====================================================================

export const VPCI_RULES_REVISION = 'Revised and accepted 4/7/2022'

export const VPCI_INSTRUCTIONS: string[] = [
  'A copy of the proposed purchase agreement or lease agreement must be submitted at least thirty (30) days prior to the expected date of occupancy.',
  'The Board of Directors reviews every completed application and, per the Declaration (Article XXII), must approve or disapprove it IN WRITING within ten (10) business days of receiving it (plus any additional information the Board requests) — if the Board does not respond within that window, the application is deemed approved. A personal interview with the Board is required before approval is granted.',
  'Occupancy is PROHIBITED prior to the Board issuing its final written approval. Failure of the Purchaser(s)/Lessee(s) and any intended adult occupant(s) to fully comply with this Application renders the purchase or lease VOID.',
  'After Board approval, estoppel letter requests should be made through www.condocerts.com.',
]

export const VPCI_RULES: string[] = [
  'Individuals only — no LLC or corporate purchasers permitted (effective 10/13/21).',
  'No Airbnb, VRBO, or other short-term rentals of any kind.',
  'Minimum lease term is 90 days; a unit may be rented at most once every 12 months.',
  'An owner who purchases after 10/7/2020 may not rent out the unit for the first two (2) years of ownership.',
  'Rentals are limited to a maximum of 20% of the total units rented out concurrently.',
  'Maximum two (2) vehicles per unit; RVs, campers, boats, trailers, oversized vans and commercial vehicles are not permitted on the property.',
  'The Association holds a Right of First Refusal on any sale, lease, or transfer.',
  'A unit may not be leased for less than the entire unit — no room rentals.',
  'ALL persons who will occupy the unit must be screened, and every occupant 18 or over must be approved.',
  'Each unit may be used only as a single-family residence; no business or commercial use.',
  'Maintenance is due the 1st of each month, late after the 10th ($25 late fee); accounts 30+ days delinquent are subject to lien and legal action.',
  'Quiet hours are 11:00 PM – 8:00 AM; no construction work after 5:00 PM on any day.',
  'Pets must be leashed at all times outside the unit; owners must clean up after their pets. No pet may be left outside the unit unattended.',
  'No exterior change or structure may be made without written approval from the Architectural Control Board.',
  'Units that are rented must carry proof of liability and renter\'s insurance provided to the Association each year.',
  'Upon expiration of a lease the Association must be notified of the unit\'s status, and any new lease must be presented for approval.',
]

// Statutory notices the signer acknowledges. Kept apart from the house rules
// because these bind the tenant by Florida statute rather than by the
// Association's discretion — the same §718.116(11) right the Rent Demand
// generator exercises when a unit goes delinquent.
export const VPCI_STATUTORY_NOTICES: { title: string; body: string }[] = [
  {
    title: 'DELINQUENT UNIT',
    body: "If the unit owner is delinquent in paying any monetary obligation due to the Association, the Association may make a written demand, pursuant to section 718.116(11), Florida Statutes, requiring the tenant to pay subsequent rent directly to the Association until the unit's monetary obligations are paid in full or the Association releases the tenant. Payments are limited to rent otherwise due and must be credited against rent owed to the owner.",
  },
]

/** The payload for a Venetian Park I rules acknowledgment e-sign document. */
export function vpciRulesAckPayload(opts: {
  associationLegalName: string
  propertyAddress?: string | null
  unit?: string | null
  applicationType?: string | null
  applicants?: string[]
}) {
  return {
    associationLegalName: opts.associationLegalName,
    propertyAddress: opts.propertyAddress ?? null,
    unit: opts.unit ?? null,
    applicationType: opts.applicationType ?? null,
    applicants: opts.applicants ?? [],
    instructions: VPCI_INSTRUCTIONS,
    rules: VPCI_RULES,
    statutoryNotices: VPCI_STATUTORY_NOTICES,
    rulesRevision: VPCI_RULES_REVISION,
  }
}
