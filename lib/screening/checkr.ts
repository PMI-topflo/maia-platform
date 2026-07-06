// =====================================================================
// lib/screening/checkr.ts
// Checkr TENANT Screening API implementation. Key differences from a
// typical Checkr integration:
//   - Bearer token auth (Authorization: Bearer ckr_sk_...), not HTTP Basic.
//   - A single POST /orders call creates the whole screening (applicant +
//     property + package) -- no separate Candidate-then-Report step.
//   - There is NO embeddable consent widget. Checkr emails the applicant a
//     link to their own hosted page (tenant.checkr.com/apply/<code>) to
//     complete consent/questionnaire -- the applicant leaves our /apply flow
//     for that step. This is a real, confirmed product constraint, not a
//     placeholder.
//   - Webhook signature: `Tenant-Signature: t=<unix_ts>,v1=<hex>` where v1 is
//     HMAC-SHA256 of "<t>.<raw_body>".
//   - Order creation requires an Idempotency-Key header.
//
// ⚠ API_BASE confirmed LIVE 2026-07-06 with a real ckr_sk_test_ key —
// `https://tenant.checkr.com/api` is the correct host+path prefix (NOT
// api.checkr.com/v1, and NOT the /v1 shown in checkr-tenant-api-docs.redocly.app's
// own placeholder examples, which use api.example.com). Confirmed BOTH real
// initial statuses via live test orders: a test-mode order with an applicant
// that doesn't match one of Checkr's Canned Provider Scenarios auto-completes
// almost immediately with status "pending" (test mode skips the applicant
// experience entirely by default -- no email/SMS sent); an order using the
// documented "Hudson Green" scenario tuple (the one row that deliberately does
// NOT circumvent the applicant experience) instead returns "waiting_for_applicant"
// and genuinely emails the applicant a hosted link, same as a real production
// order would. Both are legitimate statuses, not a guess vs. a correction.
//
// ⚠ There is no distinct "international" package. Checkr's own pricing page
// (checkr.com/pricing/international, confirmed 2026-07-06) shows international
// checks are à la carte per-country line items (e.g. Germany's criminal check
// alone takes 25-31 days), not a package slug alongside starter/essential --
// confirmed by the fact the Orders API's package enum only ever lists those
// two values. Decision (2026-07-06): international applicants get the same
// domestic Essential package everyone else gets; the country-specific gap
// (foreign criminal record, financial standing) is covered by applicant-
// uploaded documents instead (see ApplicationForm's international disclosure
// copy), not by a Checkr product.
// =====================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ScreeningProvider, ScreeningSubject, ScreeningProperty, CreateOrderResult, ScreeningWebhookEvent } from './types'

const API_BASE = 'https://tenant.checkr.com/api'

function authHeader(): string {
  return `Bearer ${process.env.CHECKR_API_KEY ?? ''}`
}

function packageFor(): string {
  // Every subject -- individual, commercial principal, or international
  // applicant -- runs the same domestic Essential check (see file header).
  const slug = process.env.CHECKR_PACKAGE_RESIDENTIAL
  if (!slug) throw new Error('CHECKR_PACKAGE_RESIDENTIAL is not configured')
  return slug
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? name, last: parts.slice(1).join(' ') || parts[0] || name }
}

/** Deterministic (not random) so a retried request after a network error
 *  reuses the same key -- true idempotency, unlike a fresh UUID per attempt. */
function idempotencyKey(subject: ScreeningSubject, property: ScreeningProperty): string {
  return `screening-${property.unit ?? 'unit'}-${subject.index}-${subject.name}`.replace(/\s+/g, '_').slice(0, 255)
}

async function checkrFetch(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Checkr ${path} ${res.status}: ${JSON.stringify(json)}`)
  return json as Record<string, unknown>
}

/** Report PDF endpoint returns application/pdf bytes, not JSON -- can't
 *  reuse checkrFetch(). Generation is synchronous but can take up to ~60s
 *  per Checkr's own Reports guide. */
async function checkrFetchPdf(path: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: authHeader() } })
  if (!res.ok) throw new Error(`Checkr ${path} ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

export const checkrProvider: ScreeningProvider = {
  name: 'checkr',

  isConfigured() {
    return !!process.env.CHECKR_API_KEY
  },

  async createOrder(subject: ScreeningSubject, property: ScreeningProperty): Promise<CreateOrderResult> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    const { first, last } = splitName(subject.name)
    const json = await checkrFetch('/orders', 'POST', {
      order: {
        package: packageFor(),
        property: {
          name: property.name ?? undefined,
          street: property.street,
          unit: property.unit ?? undefined,
          city: property.city,
          state: property.state,
          zipcode: property.zipcode,
        },
        applicant: {
          email: subject.email ?? undefined,
          first_name: first,
          last_name: last,
          dob: subject.dob ?? undefined,
          ssn: subject.ssn ?? undefined,
        },
      },
    }, { 'Idempotency-Key': idempotencyKey(subject, property) })
    const orderId = str(json.id)
    if (!orderId) throw new Error('Checkr order response had no id')
    return { orderId, status: str(json.status) ?? 'pending' }
  },

  async getOrder(orderId: string): Promise<{ status: string }> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    const json = await checkrFetch(`/orders/${orderId}`, 'GET')
    return { status: str(json.status) ?? 'pending' }
  },

  async getReportPdf(reportId: string): Promise<Buffer> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    return checkrFetchPdf(`/reports/${reportId}/pdf`)
  },

  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    const secret = process.env.CHECKR_WEBHOOK_SECRET
    if (!secret) return true   // no secret configured — accept unauthenticated, matches the old ApplyCheck fallback behavior
    if (!signatureHeader) return false
    // Format: "t=<unix_ts>,v1=<hex_hmac>"
    const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=') as [string, string]))
    const t = parts.t
    const v1 = parts.v1
    if (!t || !v1) return false
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(v1)
    return a.length === b.length && timingSafeEqual(a, b)
  },

  // Real envelope (confirmed live 2026-07-06, from Checkr's own Webhooks
  // guide): { id, object: "event", type, created_at, data: {...} } — the
  // order id lives at data.order_id, NOT top-level. Every event carries
  // order_id EXCEPT report.product.completed (data is only { id, report_id,
  // product } there) -- there's no status field anywhere in this envelope,
  // by design (see getOrder() re-fetch above).
  //
  // On report.completed specifically, data.id IS the report id (data also
  // carries order_id there) -- confirmed from Checkr's concrete per-event
  // schemas 2026-07-06. Every other event type's data.id means something
  // else (applicant id, or a report-product-result id), so reportId is only
  // populated for report.completed.
  parseWebhookEvent(payload: unknown): ScreeningWebhookEvent {
    const obj = (payload ?? {}) as Record<string, unknown>
    const type = str(obj.type) ?? 'unknown'
    const data = (obj.data ?? {}) as Record<string, unknown>
    const orderId = str(data.order_id)
    const reportId = type === 'report.completed' ? str(data.id) : null
    return { type, orderId, reportId, raw: payload }
  },
}
