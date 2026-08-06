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
