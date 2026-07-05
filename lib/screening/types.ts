// =====================================================================
// lib/screening/types.ts
// Provider-agnostic background-check interface. ApplyCheck (the original
// provider) turned out to have no public API and was rejected; Checkr
// (lib/screening/checkr.ts) is the current implementation, built against
// the real Checkr TENANT Screening API (checkr-tenant-api-docs.redocly.app)
// confirmed 2026-07-05 -- a single POST /orders call per subject, not the
// Candidates+Reports two-step flow of Checkr's general employment API.
// Callers should import the active provider from lib/screening/index.ts,
// never checkr.ts directly, so a future provider swap doesn't ripple
// through the app.
// =====================================================================

export interface ScreeningSubject {
  /** Index into applications.applicants[]/principals[] — also
   *  screening_subjects.subject_index. */
  index: number
  name: string
  email?: string | null
  dob?: string | null
  ssn?: string | null
  isCommercial: boolean
  /** app_type === 'international' — routes to the international package
   *  instead of the domestic Essential one. Mutually exclusive with isCommercial. */
  isInternational: boolean
}

/** The unit being applied for — required on every Checkr order. */
export interface ScreeningProperty {
  name?: string | null
  street: string
  unit?: string | null
  city: string
  state: string
  zipcode: string
}

export interface CreateOrderResult {
  orderId: string
  status: string
}

export interface ScreeningWebhookEvent {
  type: string
  orderId: string | null
  status: string | null
  raw: unknown
}

export interface ScreeningProvider {
  name: string
  isConfigured(): boolean
  /** Creates the whole screening in one call — applicant + property + package.
   *  The applicant then completes consent/questionnaire on Checkr's own
   *  hosted page (they're emailed a link); there is no embeddable widget. */
  createOrder(subject: ScreeningSubject, property: ScreeningProperty): Promise<CreateOrderResult>
  /** Re-fetches authoritative order status — used when a webhook fires,
   *  since the webhook payload itself doesn't reliably carry full state. */
  getOrder(orderId: string): Promise<{ status: string }>
  /** True if the raw request body's signature matches the configured
   *  webhook secret. Verify BEFORE parsing/trusting the payload. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean
  parseWebhookEvent(payload: unknown): ScreeningWebhookEvent
}
