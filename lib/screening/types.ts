// =====================================================================
// lib/screening/types.ts
// Provider-agnostic background-check interface. ApplyCheck (the original
// provider) turned out to have no public API and was rejected; Checkr
// (lib/screening/checkr.ts) is the current implementation. Callers should
// import the active provider from lib/screening/index.ts, never checkr.ts
// directly, so a future provider swap doesn't ripple through the app.
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
  /** app_type === 'international' — routes to the International Basic package
   *  instead of the domestic Essential one. Mutually exclusive with isCommercial. */
  isInternational: boolean
}

export interface CreateCandidateResult {
  candidateId: string
}

export interface CreateReportResult {
  reportId: string
  status: string
}

export interface ScreeningWebhookEvent {
  type: string
  candidateId: string | null
  reportId: string | null
  status: string | null
  reportUrl: string | null
  raw: unknown
}

export interface ScreeningProvider {
  name: string
  isConfigured(): boolean
  createCandidate(subject: ScreeningSubject): Promise<CreateCandidateResult>
  createReport(candidateId: string, subject: ScreeningSubject): Promise<CreateReportResult>
  /** True if the raw request body's signature matches the configured
   *  webhook secret. Verify BEFORE parsing/trusting the payload. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean
  parseWebhookEvent(payload: unknown): ScreeningWebhookEvent
}
