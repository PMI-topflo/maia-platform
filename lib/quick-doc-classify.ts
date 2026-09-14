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
// The expiration read (quickDocScanDetailed) gets Sonnet, not Haiku. Real
// case, MANXI 613's car registration: on the same photo, at temperature 0,
// Haiku deterministically misread "FLORIDA VEHICLE REGISTRATION" as
// "certificate of use" and invented an expiration date not printed anywhere
// on the document (3 straight identical wrong runs), while Sonnet read the
// correct label and the correct date ("Expires Midnight Mon 3/8/2027" →
// 2027-03-08) 3/3 with the same prompt. This scan drives compliance dates,
// so accuracy matters more than the extra cost/latency of one Sonnet call
// per document. quickDocKind (Drive-folder matching, lower stakes) stays Haiku.
//
// 2026-09-14: moved to Sonnet 5. Sonnet 4.5 misread the digits of MANXI 706's
// registration ("Expires Midnight Wed 4/12/2028" → 2028-02-01, twice) and
// 702's "Date Issued"; Sonnet 5 read all three test documents (702, 706
// registrations and 705's GEICO card) correctly, twice each. Sonnet 5 rejects
// the `temperature` parameter (400 "temperature is deprecated"), so it is not
// sent — the parser below decides from the captions, not from sampling luck.
const SCAN_MODEL = 'claude-sonnet-5'

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

export const SCAN_PROMPT = `You are reading a single document for a condo leasing file. Return ONLY JSON:
{"label":"<one label>","dates":[{"text":"<the caption printed next to the date, exactly as on the document>","date":"<YYYY-MM-DD>"}]}
- "label": the ONE best match from this list: ${LABELS.join(', ')} (use "other" if none fit). A document titled "FLORIDA VEHICLE REGISTRATION" or similar, with a plate/tag number, VIN, and vehicle year/make, is "vehicle registration" — NOT "certificate of use" (that label is a municipal rental/occupancy certificate, a DMV document is never one).
- "dates": EVERY date printed on the document together with the caption that labels it, exactly as printed — e.g. {"text":"Expires Midnight Mon","date":"2027-03-08"}, {"text":"Plate Issued","date":"2026-06-26"}, {"text":"Effective Date","date":"2026-07-01"}, {"text":"EXP","date":"2029-01-15"}, {"text":"Policy Period","date":"2027-02-01"}, {"text":"Lease end","date":"2027-06-30"}, {"text":"DOB","date":"1988-08-09"}. Dates are printed American-style, MONTH/DAY/YEAR — "3/8/2027" means March 8 2027 → "2027-03-08", NOT August 3. Read every digit carefully; never invent a date that is not printed. Do not decide which date is the expiration — just report each date with its caption; an empty list is fine for a document with no dates (a deed, an affidavit).`

// Which caption means what. The model only transcribes; MAIA decides — a
// model asked for "the expiration" kept returning a registration's "Plate
// Issued" or an insurance card's "Effective Date" (MANXI 702 / 705,
// 2026-09-14), whatever the prompt said.
const EXPIRY_RE  = /\b(exp|expires?|expiration|expiry|valid (thru|through|until|to)|good (thru|through)|end(s|ing)? date|through|to|until)\b/i
const ISSUED_RE  = /\b(issued?|issue date|plate issued|date issued|effective|eff\.?|start|from|inception|policy period start)\b/i
const IGNORE_RE  = /\b(dob|birth|born|printed|signed|signature|paid|receipt|transaction|report date|as of)\b/i
/** One year after a YYYY-MM-DD date. */
function plusOneYear(d: string): string { const x = new Date(d + 'T12:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + 1); return x.toISOString().slice(0, 10) }

export interface DocScan { label: string; expiration: string | null; issued?: string | null }
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
      model: SCAN_MODEL, max_tokens: 400,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: [block as any, { type: 'text', text: SCAN_PROMPT }] }],
    })
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { label: 'other', expiration: null, ok: false, error: 'the model did not return JSON' }
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const label = String(o.label ?? 'other').toLowerCase().trim()
    const finalLabel = LABELS.includes(label) ? label : 'other'
    const dates = (Array.isArray(o.dates) ? o.dates as { text?: unknown; date?: unknown }[] : [])
      .map(d => ({ text: String(d.text ?? '').trim(), date: typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date.trim()) ? d.date.trim() : null }))
      .filter((d): d is { text: string; date: string } => !!d.date && !IGNORE_RE.test(d.text))
    // An explicit expiration caption wins; the latest one if several.
    const expiries = dates.filter(d => EXPIRY_RE.test(d.text) && !ISSUED_RE.test(d.text.replace(/valid (thru|through|until|to)/i, ''))).map(d => d.date).sort()
    const issuedDates = dates.filter(d => ISSUED_RE.test(d.text) && !EXPIRY_RE.test(d.text)).map(d => d.date).sort()
    let exp: string | null = expiries.length ? expiries[expiries.length - 1] : null
    const issued: string | null = issuedDates.length ? issuedDates[issuedDates.length - 1] : null
    // Vehicle registration / auto insurance card: valid ONE YEAR from the
    // issue / effective date when no expiration line is printed (user rule,
    // 2026-09-14). An expiration equal to the issue date is the same mistake.
    if ((finalLabel === 'vehicle registration' || finalLabel === 'vehicle insurance') && issued && (!exp || exp === issued)) exp = plusOneYear(issued)
    // Anything else with only an issue date and no expiration: leave null —
    // staff decide.
    return { label: finalLabel, expiration: exp, issued, ok: true }
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
