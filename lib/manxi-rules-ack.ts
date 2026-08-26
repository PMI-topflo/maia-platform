// =====================================================================
// lib/manxi-rules-ack.ts
//
// The Manors of Inverrary XI's Rules Knowledge Acknowledgment content, lifted
// from the association's own Applicant Rules & Official Documents packet.
//
// The packet carries THREE recorded source documents of different vintages —
// the 1989 Rules and Regulations, the 1986 Rules and Regulations, and Manors
// Club, Inc.'s 2012 Master Association rules — plus a current requirements
// summary drawn from the association's live purchase/lease application. The
// scanned pages are spliced in verbatim (see lib/rules-ack-pdf.ts); what is
// listed below is the MAIA cover summary that sits in front of them.
//
// AS WITH VPCI, TWO KINDS OF INSTRUCTION ARE DELIBERATELY NOT REPEATED HERE:
// anything telling the applicant to email a signed packet somewhere, and
// anything telling them to run their own background check. MAIA collects the
// documents and orders the screening, so repeating those sends the applicant
// to a process that no longer applies.
//
// The packet's own "APPLICANT ACKNOWLEDGMENT" page and its blank ink-signature
// lines are likewise not spliced in — `rules_knowledge_ack` supplies the
// acknowledgment and the verified electronic signatures itself.
// =====================================================================

// Kept SHORT on purpose — it renders as the value of a two-column row on the
// cover page, and a long string wraps back over its own label.
export const MANXI_RULES_REVISION = 'Recorded 1986 and 1989 · Manors Club 2012'

export const MANXI_INSTRUCTIONS: string[] = [
  'The completed application must be submitted at least thirty (30) days before the expected closing or lease date.',
  'The proposed purchaser or lessee must complete the application in detail. If any question is left unanswered or blank, the application may be returned as incomplete.',
  'A copy of the sales contract or the completed lease must be attached to the application.',
  'All applicants must make themselves available for a personal interview before final approval. The $150.00 application/interview fee is payable to the Association on the date of the interview.',
  'Closing documents and the closing statement must be submitted to the Association before move-in.',
]

export const MANXI_RULES: string[] = [
  'Certificates of approval will NOT be issued to trusts or LLCs.',
  'YEARLY INCOME: $42,000 for a single person and $52,000 for a married couple. The last two years of completed tax returns are required as proof — W-2s alone are not accepted.',
  'PURCHASE APPLICANTS — CREDIT SCORE / ADVANCE MAINTENANCE: a credit score of 635-660 requires one year of advance maintenance; 661-750 requires six months; 751-850 requires none.',
  'MAINTENANCE ASSESSMENTS: due quarterly (January, April, July, October). Assessments and installments not paid when due are subject to a $25.00 late fee per quarter. (Amendment to Rule 56, recorded May 22, 1997, Broward County Official Records Book 26543, Page 0575.)',
  'PURCHASE APPLICANTS: the purchase contract must show a 10% deposit with a proof-of-escrow letter confirming the deposit is held in escrow; an HO-6 insurance quote is required with the application and the issued HO-6 policy after closing; and the Florida Board of Realtors Condominium Rider must accompany the purchase contract.',
  'APPLICATION / INTERVIEW FEE: $150.00, payable to the Association on the date of the interview.',
  'NO PETS ARE PERMITTED AT ANY TIME. This rule does not apply to a service animal or an emotional support / assistance animal. Those are reasonable-accommodation requests under the Fair Housing Act and Florida law, are handled separately from this pet rule, and are never subject to a pet fee, pet deposit, or breed or size restriction. Tell the Association if you have one and the accommodation request will be processed.',
  'A copy of the vehicle registration(s) and a copy of the driver\'s license must be provided for each applicant.',
  'No commercial vehicles, pick-up trucks, trailers, RVs, campers, motorcycles, mopeds, or scooters are permitted on the condominium premises.',
  'OCCUPANCY: one-bedroom apartments — maximum three (3) occupants. Two-bedroom apartments — maximum four (4) occupants.',
  'LEASE RENEWAL: there is a yearly lease renewal procedure, and a lease must be renewed at least 30 days before its expiration date.',
  'Manors Club, Inc. is the Master Association. Its Rules and Regulations are separate from, and apply in addition to, Manors XI requirements when using or occupying Manors Club property, facilities, parking areas and recreational areas.',
  'Where a valid later requirement conflicts with a provision of an older recorded document reproduced in this packet, the later requirement is the one to be followed.',
]

// Statutory notices the signer acknowledges. Kept apart from the house rules
// because these bind the tenant by Florida statute rather than by the
// Association's discretion — the same §718.116(11) right the Rent Demand
// generator exercises when a unit goes delinquent.
export const MANXI_STATUTORY_NOTICES: { title: string; body: string }[] = [
  {
    title: 'DELINQUENT UNIT',
    body: "If the unit owner is delinquent in paying any monetary obligation due to the Association, the Association may make a written demand, pursuant to section 718.116(11), Florida Statutes, requiring the tenant to pay subsequent rent directly to the Association until the unit's monetary obligations are paid in full or the Association releases the tenant. Payments are limited to rent otherwise due and must be credited against rent owed to the owner.",
  },
]
