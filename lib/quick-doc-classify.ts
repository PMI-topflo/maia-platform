// =====================================================================
// lib/quick-doc-classify.ts
// A FAST, single Haiku call that names what a document is, in a few words —
// used by the application "scan the Drive folder" import and can back other
// lightweight matching. Much cheaper than lib/document-classifier (which does
// Haiku→Sonnet escalation + association matching) so scanning a folder of files
// doesn't time out. Mirrors lib/tax-doc-check's model-call pattern.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const HAIKU = 'claude-haiku-4-5-20251001'

const LABELS = [
  'lease agreement', 'landlord-tenant agreement', 'drivers license or photo id',
  'vehicle registration', 'vehicle insurance', 'property or homeowner insurance',
  'tax return', 'certificate of use', 'deed or ownership', 'governing documents acknowledgement',
  'board approval letter', 'board decision page', 'tenant affidavit', 'email or letter', 'other',
]

const PROMPT = `You are naming a single document for a condo leasing file. Choose the ONE best label from this list:
${LABELS.map(l => `- ${l}`).join('\n')}
Return ONLY JSON: {"label":"<one label exactly as written>"}. If none fit, use "other".`

function mediaTypeFor(ct: string | null): 'image/jpeg' | 'image/png' | 'image/webp' {
  const c = (ct ?? '').toLowerCase()
  if (c.includes('png')) return 'image/png'
  if (c.includes('webp')) return 'image/webp'
  return 'image/jpeg'
}

const SCAN_PROMPT = `You are reading a single document for a condo leasing file. Return ONLY JSON:
{"label":"<one label>","expiration":"<YYYY-MM-DD or null>"}
- "label": the ONE best match from this list: ${LABELS.join(', ')} (use "other" if none fit).
- "expiration": ANY expiration / valid-through / "EXP" date printed on the document, in YYYY-MM-DD. Look hard for it: a driver's license or state ID "EXP" date, a vehicle registration expiration, an insurance policy expiration/period-end, a certificate-of-use expiry, or a lease end date. If the document genuinely has no expiration (e.g. a deed, an affidavit, a tax return), return null.`

export interface DocScan { label: string; expiration: string | null }
/** A scan that also says whether it actually READ the document. `ok: false`
 *  means the read failed (no key, budget, unreadable file, bad model output) —
 *  which is NOT the same as "read it, the document has no expiration printed".
 *  Ingest paths don't care (they store what they got and move on), but a staff
 *  re-scan must be able to tell the two apart. */
export interface DocScanResult extends DocScan { ok: boolean; error?: string }

/** One Haiku call → { label, expiration } for the scan review. */
export async function quickDocScan(buf: Buffer, contentType: string | null): Promise<DocScan> {
  const { label, expiration } = await quickDocScanDetailed(buf, contentType)
  return { label, expiration }
}

/** As `quickDocScan`, but reports read failures instead of flattening them into
 *  an empty result. Used by the staff "🔍 Read expiration" re-scan so a failed
 *  read shows as a failure rather than as "this document doesn't expire". */
export async function quickDocScanDetailed(buf: Buffer, contentType: string | null): Promise<DocScanResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { label: 'other', expiration: null, ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  try {
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
    const b64 = buf.toString('base64')
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }
    await assertClaudeBudget('quick-doc-scan')
    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 80,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: SCAN_PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { label: 'other', expiration: null, ok: false, error: 'the model did not return JSON' }
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const label = String(o.label ?? 'other').toLowerCase().trim()
    const exp = typeof o.expiration === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.expiration.trim()) ? o.expiration.trim() : null
    return { label: LABELS.includes(label) ? label : 'other', expiration: exp, ok: true }
  } catch (err) { return { label: 'other', expiration: null, ok: false, error: (err as Error).message } }
}

/** One quick Haiku call → a short document-type phrase (from LABELS), or 'other'. */
export async function quickDocKind(buf: Buffer, contentType: string | null): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return 'other'
  try {
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-' || (contentType ?? '').includes('pdf')
    const b64 = buf.toString('base64')
    const block = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(contentType), data: b64 } }
    await assertClaudeBudget('quick-doc-classify')
    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: HAIKU, max_tokens: 40,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return 'other'
    const label = String((JSON.parse(m[0]) as Record<string, unknown>).label ?? 'other').toLowerCase().trim()
    return LABELS.includes(label) ? label : 'other'
  } catch { return 'other' }
}
