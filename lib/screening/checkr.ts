// =====================================================================
// lib/screening/checkr.ts
// Checkr TENANT Screening API implementation (checkr-tenant-api-docs.redocly.app,
// confirmed live 2026-07-05) -- NOT Checkr's general employment-background-check
// API. Key differences from a typical Checkr integration:
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
// ⚠ Still unconfirmed: the exact package slug for international applicants
// (public docs only show "starter"/"essential" as named packages, plus
// individual add-on products like global_watchlist) -- CHECKR_PACKAGE_INTERNATIONAL
// needs confirming with a real Checkr account rep before go-live. Webhook
// payload's exact JSON shape for extracting the order id is also a
// best-effort guess (docs describe event *names* but not a full payload
// example) -- getOrder() re-fetches authoritative state rather than trusting
// the webhook body, specifically to route around that gap.
// =====================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ScreeningProvider, ScreeningSubject, ScreeningProperty, CreateOrderResult, ScreeningWebhookEvent } from './types'

const API_BASE = 'https://api.checkr.com/v1'

function authHeader(): string {
  return `Bearer ${process.env.CHECKR_API_KEY ?? ''}`
}

function packageFor(subject: ScreeningSubject): string {
  // Commercial-application principals get the same Essential check as an
  // individual applicant (same package, same price, per principal) — the
  // "commercial" distinction only affects which applications.* array the
  // subject came from, not which Checkr package runs.
  const tier = subject.isInternational ? 'INTERNATIONAL' : 'RESIDENTIAL'
  const slug = process.env[`CHECKR_PACKAGE_${tier}`]
  if (!slug) throw new Error(`CHECKR_PACKAGE_${tier} is not configured`)
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

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** Defensive extraction across a few plausible nesting shapes for the order
 *  id in a webhook payload — the exact envelope isn't confirmed against a
 *  real captured payload yet (see file header). */
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

  async createOrder(subject: ScreeningSubject, property: ScreeningProperty): Promise<CreateOrderResult> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    const { first, last } = splitName(subject.name)
    const json = await checkrFetch('/orders', 'POST', {
      order: {
        package: packageFor(subject),
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
    return { orderId, status: str(json.status) ?? 'waiting_for_applicant' }
  },

  async getOrder(orderId: string): Promise<{ status: string }> {
    if (!this.isConfigured()) throw new Error('CHECKR_API_KEY is not configured')
    const json = await checkrFetch(`/orders/${orderId}`, 'GET')
    return { status: str(json.status) ?? 'pending' }
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

  parseWebhookEvent(payload: unknown): ScreeningWebhookEvent {
    const obj = (payload ?? {}) as Record<string, unknown>
    const type = str(obj.type) ?? 'unknown'
    const orderId = str(pick(obj, ['order_id', 'id']))
    const status = str(pick(obj, ['status']))
    return { type, orderId, status, raw: payload }
  },
}
