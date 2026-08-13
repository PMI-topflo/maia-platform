// =====================================================================
// lib/intake-naming.ts
//
// One place for the "YYYY_MM_Type" filing name used across every intake path
// (Drive scan, From-Drive pick, staff upload, applicant upload). This map used
// to be duplicated per route, which is how `signed_purchase` ended up missing
// from one copy and a purchase agreement filed itself as "Document".
// =====================================================================

export const DOC_TYPE_TOKEN: Record<string, string> = {
  signed_lease: 'Lease', signed_purchase: 'Purchase', lease_addendum: 'LeaseAddendum',
  drivers_license: 'ID', car_registration: 'VehicleReg', vehicle_insurance: 'VehicleInsurance',
  landlord_email: 'LandlordEmail', tax_returns_2yr: 'TaxReturns', property_insurance: 'Insurance',
  certificate_of_use: 'LauderhillCert', board_decision_page: 'DecisionPage',
  tenant_affidavit: 'Affidavit', occupant_affidavit: 'OccupantAffidavit',
  landlord_tenant_agreement: 'Agreement', board_approval_letter: 'BoardApproval',
  deed: 'Deed', ownership: 'Ownership', governing_docs_ack: 'RulesAck', hoa_estoppel: 'Estoppel',
  background_credit: 'BackgroundCredit', emergency_contact: 'EmergencyContacts', pet_esa_documents: 'AnimalDocs',
}

/** "2026_08_Lease.pdf" — with the person appended for per-applicant documents. */
export function suggestedIntakeName(opts: { docKey: string; filename?: string | null; when?: string | Date | null; personName?: string | null }): string {
  const d = opts.when ? new Date(opts.when) : new Date()
  const stamp = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const name = opts.filename ?? ''
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.pdf'
  const who = (opts.personName ?? '').trim()
  return `${stamp}_${DOC_TYPE_TOKEN[opts.docKey] ?? 'Document'}${who ? ` — ${who}` : ''}${ext}`
}
