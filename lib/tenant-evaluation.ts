// =====================================================================
// lib/tenant-evaluation.ts
//
// Background / Credit Reports (doc_key `background_credit`) is `provided_by:
// 'staff'` — the report itself never comes from the applicant, staff pull it
// from Tenant Evaluation (or, once connected, Checkr) and upload it. But the
// APPLICATION that produces that report is the applicant's own to submit, on
// Tenant Evaluation's own site, and staff had no way to ask them to start it
// short of typing the property code into an email by hand each time.
//
// User direction, 2026-08-20: attach the association's own step-by-step guide
// (screenshots, property code, QR code) and let staff send it with one click,
// same pattern as RulesAckSender/PetRegSender. Config is per-association
// because the property code and guide are — MANXI is the only one seeded so
// far; add another association here once its own guide + code are in hand.
// =====================================================================

export interface TenantEvaluationGuide {
  /** Path inside the `application-docs` storage bucket. */
  storagePath: string
  /** The 4-5 digit property code applicants enter on Tenant Evaluation. */
  propertyCode: string
  /** Direct apply URL, offered as a fallback to the code + QR flow. */
  applyUrl: string
}

export const TENANT_EVALUATION_GUIDES: Record<string, TenantEvaluationGuide> = {
  MANXI: {
    storagePath: 'templates/MANXI/tenant-evaluation-guide.pdf',
    propertyCode: '14755',
    applyUrl: 'https://pmi-top-florida-properties.applytomove.com/',
  },
}
