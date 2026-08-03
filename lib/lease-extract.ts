// =====================================================================
// lib/lease-extract.ts
//
// Read a residential lease with Claude and pull the fields we save into the
// unit's tenant record: tenant name(s), landlord/owner name(s), and the lease
// term (start + end). Backs "Save tenant info" on the Drive-organize screen —
// so a signed lease auto-populates unit_tenant_contacts for staff to confirm.
// Best-effort; never throws.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const HAIKU = 'claude-haiku-4-5-20251001'

export interface LeaseDetails {
  tenantNames: string[]
  ownerNames: string[]
  leaseStart: string | null   // ISO
  leaseEnd: string | null      // ISO
  monthlyRent: string | null
  tenantEmail: string | null
  tenantPhone: string | null
}

function isoDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
function names(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean).slice(0, 6)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}
function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

const PROMPT = `You are reading a residential lease / rental agreement, or a tenant-and-landlord affidavit. Extract ONLY minified JSON:
{"tenant_names": string[], "owner_names": string[], "lease_start": "YYYY-MM-DD"|null, "lease_end": "YYYY-MM-DD"|null, "monthly_rent": string|null, "tenant_email": string|null, "tenant_phone": string|null}
- tenant_names: all TENANTS / lessees / occupants (NOT the landlord).
- owner_names: the LANDLORD / lessor / owner (or their management company) — keep separate from tenants.
- lease_start / lease_end: the lease term dates if present (a renewal uses the renewal term); null on an affidavit that has no term.
- monthly_rent: the rent amount as written (e.g. "$1,850"), or null.
- tenant_email / tenant_phone: the TENANT's email and phone if shown (NOT the landlord's or agent's); null if absent.
Use null / [] when a field isn't clearly present.`

export async function extractLeaseDetails(buf: Buffer, contentType: string | null): Promise<LeaseDetails> {
  const empty: LeaseDetails = { tenantNames: [], ownerNames: [], leaseStart: null, leaseEnd: null, monthlyRent: null, tenantEmail: null, tenantPhone: null }
  if (!process.env.ANTHROPIC_API_KEY) return empty
  try {
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
    const b64 = buf.toString('base64')
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }

    await assertClaudeBudget('lease-extract')
    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 400,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return empty
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null
    return {
      tenantNames: names(o.tenant_names), ownerNames: names(o.owner_names),
      leaseStart: isoDate(o.lease_start), leaseEnd: isoDate(o.lease_end),
      monthlyRent: str(o.monthly_rent),
      tenantEmail: str(o.tenant_email), tenantPhone: str(o.tenant_phone),
    }
  } catch { return empty }
}
