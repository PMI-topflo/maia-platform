// =====================================================================
// lib/tax-doc-check.ts
//
// The one real validation in the Pre-Application intake: applicants must upload
// a TAX RETURN (Form 1040 etc.), not a W-2. People routinely upload the W-2 by
// mistake. MAIA reads the uploaded tax document and classifies it so the auditor
// isn't fooled. Best-effort — returns unknown on any failure, never throws.
// Mirrors lib/board-cert-extract's model-call pattern.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const HAIKU = 'claude-haiku-4-5-20251001'

function mediaTypeFor(ct?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const c = (ct ?? '').toLowerCase()
  if (c.includes('png')) return 'image/png'
  if (c.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

const PROMPT = `You are auditing a document uploaded as an applicant's income proof. Decide what it is:
- "tax_return": a filed federal/state income tax return (e.g. IRS Form 1040, 1040-SR, 1040-NR, or a state equivalent).
- "w2": a Form W-2 Wage and Tax Statement (an employer wage form — NOT a tax return).
- "other": anything else (paystub, bank statement, 1099, unreadable, etc.).
Respond with ONLY JSON: {"kind":"tax_return"|"w2"|"other","confidence":0-1}`

export interface TaxDocResult { kind: 'tax_return' | 'w2' | 'other' | 'unknown'; confidence: number }

export async function classifyTaxDoc(buf: Buffer, contentType: string | null): Promise<TaxDocResult> {
  const unknown: TaxDocResult = { kind: 'unknown', confidence: 0 }
  if (!process.env.ANTHROPIC_API_KEY) return unknown
  try {
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
    const b64 = buf.toString('base64')
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }

    await assertClaudeBudget('tax-doc-check')
    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 60,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return unknown
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const kind = o.kind === 'tax_return' || o.kind === 'w2' || o.kind === 'other' ? o.kind : 'unknown'
    const confidence = typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0
    return { kind, confidence }
  } catch {
    return unknown
  }
}
