// =====================================================================
// lib/board-cert-extract.ts
//
// Read a Florida board-member certificate/form with Claude and pull out the
// COMPLETION / issuance date (the "Dated this __ day of __, ____" line on a
// DBPR Certificate of Completion, or the signature date on a Board Member
// Certification Form) plus which of the two document types it is. The
// certificate date drives the validity window (condo +7y / HOA +4y), so
// staff shouldn't have to transcribe it by hand.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'
import type { CertDocType } from '@/lib/board-certification'

const HAIKU = 'claude-haiku-4-5-20251001'

export interface CertExtract {
  completionDate: string | null   // ISO YYYY-MM-DD
  docType: CertDocType | null
  confidence: number
}

function isoDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function mediaTypeFor(contentType?: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

const PROMPT = `You are reading a Florida condominium/HOA board-member document. Identify which it is and the key date.

Document types:
- "education_certificate": a DBPR "Certificate of Completion" for the board-education course (§718.112(2)(d)4.b / §720.3033). Its date is the "DATED THIS __ DAY OF __, ____" line.
- "certification_form": the signed "Condominium/HOA Association Board Member Certification Form" where a member certifies they read the declaration/bylaws. Its date is the signature "Date:" line.

Return ONLY minified JSON:
{"doc_type": "education_certificate"|"certification_form"|null, "completion_date": "YYYY-MM-DD"|null, "confidence": 0..1}

completion_date is the date the course was completed / the form was signed — NOT any expiration. If you cannot read a clear date, use null.`

/** Best-effort extraction. Never throws — returns nulls on any failure so the
 *  upload path is never blocked by the AI read. */
export async function extractCertificateDate(buf: Buffer, contentType: string | null): Promise<CertExtract> {
  const empty: CertExtract = { completionDate: null, docType: null, confidence: 0 }
  if (!process.env.ANTHROPIC_API_KEY) return empty
  try {
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
    const b64 = buf.toString('base64')
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }

    await assertClaudeBudget('board-cert-extract')
    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 200,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return empty
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const dt = o.doc_type
    const docType: CertExtract['docType'] =
      dt === 'education_certificate' || dt === 'certification_form' || dt === 'continuing_education' ? dt : null
    const confidence = typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0
    return { completionDate: isoDate(o.completion_date), docType, confidence }
  } catch {
    return empty
  }
}
