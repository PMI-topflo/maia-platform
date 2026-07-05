// =====================================================================
// lib/screening/checkr.ts
// Checkr implementation of the ScreeningProvider interface (Option 3 —
// Self-Hosted Flow + Disclosure & Consent Embed): we collect the
// candidate's info in our own /apply UI, the browser-side Disclosure &
// Consent Embed captures the legally-required consent, and only THEN do we
// call the Report API — Checkr's docs are explicit that consent must be
// captured before a Report is created.
//
// ⚠ Built from Checkr's API Guided Onboarding materials (slides/screenshots
// the user supplied), not a live test against a real Checkr account — there
// is no CHECKR_API_KEY configured anywhere in this repo yet. The candidate/
// report request shapes and the webhook signature scheme below are Checkr's
// well-documented, stable v1 REST conventions and should be correct, but
// confirm against https://docs.checkr.com/ (and check real staging webhook
// payloads once CHECKR_API_KEY + a staging account exist) before the first
// live run — see lib/screening/index.ts for where this plugs in.
// =====================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ScreeningProvider, ScreeningSubject, CreateCandidateResult, CreateReportResult, ScreeningWebhookEvent } from './types'

const API_BASE = 'https://api.checkr.com/v1'

function authHeader(): string {
  // Checkr auth: HTTP Basic with the API key as the username, blank password.
  const key = process.env.CHECKR_API_KEY ?? ''
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

function packageFor(subject: ScreeningSubject): string {
  const tier = subject.isCommercial ? 'COMMERCIAL' : subject.isInternational ? 'INTERNATIONAL' : 'RESIDENTIAL'
  const slug = process.env[`CHECKR_PACKAGE_${tier}`]
  if (!slug) throw new Error(`CHECKR_PACKAGE_${tier} is not configured`)
  return slug
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? name, last: parts.slice(1).join(' ') || parts[0] || name }
}

async function checkrFetch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Checkr ${path} ${res.status}: ${JSON.stringify(json)}`)
  return json as Record<string, unknown>
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** Defensive extraction across a few plausible nesting shapes — mirrors the
 *  pattern the old ApplyCheck webhook handler used, since we don't yet have
 *  a real captured Checkr webhook payload to confirm the exact shape against. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const nests = [obj, obj.data, (obj.data as Record<string, unknown> | undefined)?.object].filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object',
  )
  for (const src of nests) for (const k of keys) if (src[k] != null && src[k] !== '') return src[k]
  return undefined
}

export const checkrProvider: ScreeningProvider = {
  name: 'checkr',

  isConfigured() {
    return !!process.env.CHECKR_API_KEY
  },

  async createCandidate(subject: ScreeningSubject): Promise<CreateCandidateResult> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    const { first, last } = splitName(subject.name)
    const json = await checkrFetch('/candidates', {
      first_name: first,
      last_name: last,
      email: subject.email ?? undefined,
      dob: subject.dob ?? undefined,
      ssn: subject.ssn ?? undefined,
      no_middle_name: true,
    })
    const candidateId = str(json.id)
    if (!candidateId) throw new Error('Checkr candidate response had no id')
    return { candidateId }
  },

  async createReport(candidateId: string, subject: ScreeningSubject): Promise<CreateReportResult> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    const json = await checkrFetch('/reports', {
      candidate_id: candidateId,
      package: packageFor(subject),
    })
    const reportId = str(json.id)
    if (!reportId) throw new Error('Checkr report response had no id')
    return { reportId, status: str(json.status) ?? 'pending' }
  },

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    const secret = process.env.CHECKR_WEBHOOK_SECRET
    if (!secret) return true   // no secret configured — accept unauthenticated, matches the old ApplyCheck fallback behavior
    if (!signatureHeader) return false
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(signatureHeader)
    return a.length === b.length && timingSafeEqual(a, b)
  },

  parseWebhookEvent(payload: unknown): ScreeningWebhookEvent {
    const obj = (payload ?? {}) as Record<string, unknown>
    const type = str(obj.type) ?? 'unknown'
    const candidateId = str(pick(obj, ['candidate_id']))
    const reportId = str(pick(obj, ['id', 'report_id']))
    const status = str(pick(obj, ['status', 'result']))
    const reportUrl = str(pick(obj, ['report_url', 'document_url', 'result_url']))
    return { type, candidateId, reportId, status, reportUrl, raw: payload }
  },
}
