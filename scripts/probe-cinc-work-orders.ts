// =====================================================================
// scripts/probe-cinc-work-orders.ts
//
// Read-only discovery script for CINC work-order attachments. CINC's
// docs don't tell us how photos attached by vendors come back, so we
// brute-force several candidate endpoint shapes and print the raw
// (PII-redacted) JSON so we can pick the right one.
//
// USAGE:
//   npx tsx scripts/probe-cinc-work-orders.ts <WORK_ORDER_ID>
//   # e.g.
//   npx tsx scripts/probe-cinc-work-orders.ts 12345
//
// All calls are GETs — no writes. Names/emails/phones/addresses are
// redacted to "<redacted:string len=N>" so the output is safe to share.
//
// Loads CINC_CLIENT_ID / CINC_CLIENT_SECRET / CINC_AUTH_URL /
// CINC_API_BASE from .env.local.
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- Load .env.local ---
try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx < 1) continue
    const key = line.slice(0, eqIdx).trim()
    let val = line.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* fall through to process.env */ }

const WORK_ORDER_ID_RAW = process.argv[2] || ''
const WORK_ORDER_ID     = Number(WORK_ORDER_ID_RAW)
const CLIENT_ID         = process.env.CINC_CLIENT_ID
const CLIENT_SECRET     = process.env.CINC_CLIENT_SECRET
const SCOPE             = process.env.CINC_SCOPE     ?? 'cincapi.all'
const orDefault         = (v: string | undefined, d: string) => (v && v.trim()) ? v : d
const AUTH_URL          = orDefault(process.env.CINC_AUTH_URL, 'https://identity.cincsys.com/connect/token')
const API_BASE          = orDefault(process.env.CINC_API_BASE, 'https://PMITFP.cincsys.com/api').replace(/\/$/, '')

if (!WORK_ORDER_ID_RAW || !Number.isFinite(WORK_ORDER_ID) || WORK_ORDER_ID <= 0) {
  console.error('Usage: npx tsx scripts/probe-cinc-work-orders.ts <WORK_ORDER_ID>')
  console.error('Example: npx tsx scripts/probe-cinc-work-orders.ts 12345')
  console.error('')
  console.error('Pick a work order in CINC that already has at least one photo')
  console.error('attached so the probe has something to find.')
  process.exit(1)
}
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CINC_CLIENT_ID / CINC_CLIENT_SECRET in .env.local')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────
// PII redaction
// ─────────────────────────────────────────────────────────────────────
const PII_KEYS = new Set([
  'firstname','first_name','lastname','last_name','middlename','middle_name',
  'fullname','full_name','name','displayname','display_name','contactname','contact_name',
  'email','emailaddress','email_address','personalemail','personal_email',
  'phone','phonenumber','phone_number','phone1','phone2','phone3','mobile','cell','workphone',
  'address','street','street1','street2','addressline1','addressline2','mailingaddress',
  'city','state','zip','zipcode','zip_code','postalcode',
  'ssn','taxid','ein',
])

// Keys that probably hold attachment-y data — keep them readable so we
// can see file names, URLs, mime types, sizes etc.
const KEEP_KEYS = new Set([
  'attachmentid','attachment_id','attachmenttype','attachment_type',
  'filename','file_name','file','fileurl','file_url','url','uri','href','link',
  'mimetype','mime_type','mime','contenttype','content_type','extension','ext',
  'size','filesize','file_size','bytes',
  'thumbnail','thumbnailurl','thumbnail_url','thumb','thumburl',
  'photoid','photo_id','pictureid','picture_id','imageid','image_id',
  'noteid','note_id','workorderid','work_order_id',
  'iscoverphoto','is_cover_photo','isimage','is_image','ispublic','is_public',
  'createddate','created_date','uploadeddate','uploaded_date',
])

function redact(obj: unknown, key = ''): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) {
    return obj.slice(0, 5).map((v, idx) => redact(v, `${key}[${idx}]`))
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = redact(v, k)
    return out
  }
  const k = key.toLowerCase().replace(/[_-]/g, '')
  if (KEEP_KEYS.has(k)) return obj
  if (PII_KEYS.has(k) && typeof obj === 'string' && obj.length > 0) {
    return `<redacted:string len=${obj.length}>`
  }
  if (typeof obj === 'string' && obj.length > 500) {
    return obj.slice(0, 500) + `… (truncated, total len=${obj.length})`
  }
  return obj
}

// ─────────────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────────────
async function getToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    scope:         SCOPE,
  })
  const res = await fetch(AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  if (!res.ok) throw new Error(`token failed (${res.status}): ${await res.text()}`)
  const data = await res.json() as { access_token: string }
  return data.access_token
}

// ─────────────────────────────────────────────────────────────────────
// Probe an endpoint
// ─────────────────────────────────────────────────────────────────────
interface ProbeResult {
  label:       string
  endpoint:    string
  url:         string
  status:      number | null
  ok:          boolean
  contentType: string | null
  rowCount:    number | null
  topKeys:     string[] | null
  sample:      unknown
  error:       string | null
}

function topLevelKeys(parsed: unknown): string[] | null {
  if (Array.isArray(parsed)) {
    const first = parsed[0]
    if (first && typeof first === 'object') return Object.keys(first)
    return []
  }
  if (parsed && typeof parsed === 'object') return Object.keys(parsed)
  return null
}

async function probe(
  token: string,
  label: string,
  endpoint: string,
  query: Record<string, string | number> = {},
): Promise<ProbeResult> {
  const url = new URL(`${API_BASE}${endpoint}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      },
    })
    const ct   = res.headers.get('content-type') ?? ''
    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text.slice(0, 500) }
    const rowCount = Array.isArray(parsed) ? parsed.length : null
    return {
      label,
      endpoint,
      url:         url.toString(),
      status:      res.status,
      ok:          res.ok,
      contentType: ct || null,
      rowCount,
      topKeys:     topLevelKeys(parsed),
      sample:      redact(parsed),
      error:       null,
    }
  } catch (err) {
    return {
      label,
      endpoint,
      url:         url.toString(),
      status:      null,
      ok:          false,
      contentType: null,
      rowCount:    null,
      topKeys:     null,
      sample:      null,
      error:       (err as Error).message,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const token = await getToken()
  console.error('[probe] token OK')
  console.error(`[probe] WorkOrderId=${WORK_ORDER_ID}`)

  // Re-check the baseline work-order payload first — it might already
  // carry attachments under a key we haven't mapped into CincWorkOrder.
  // Then try several candidate endpoint shapes.
  const probes: Array<{ label: string; ep: string; query?: Record<string, string | number> }> = [
    // 0. Baseline: the work order itself. See if attachments are inline.
    { label: 'baseline-workOrders',           ep: '/management/1/workOrders',                 query: { workOrderId: WORK_ORDER_ID } },
    { label: 'baseline-workOrders-include',   ep: '/management/1/workOrders',                 query: { workOrderId: WORK_ORDER_ID, include: 'attachments' } },
    { label: 'baseline-workOrders-v2',        ep: '/management/2/workOrders',                 query: { workOrderId: WORK_ORDER_ID } },

    // 1. Sibling collection endpoints, plural/singular variations.
    { label: 'workOrderAttachments',          ep: '/management/1/workOrderAttachments',       query: { workOrderId: WORK_ORDER_ID } },
    { label: 'workOrderAttachment',           ep: '/management/1/workOrderAttachment',        query: { workOrderId: WORK_ORDER_ID } },
    { label: 'workOrderPhotos',               ep: '/management/1/workOrderPhotos',            query: { workOrderId: WORK_ORDER_ID } },
    { label: 'workOrderPictures',             ep: '/management/1/workOrderPictures',          query: { workOrderId: WORK_ORDER_ID } },
    { label: 'workOrderImages',               ep: '/management/1/workOrderImages',            query: { workOrderId: WORK_ORDER_ID } },
    { label: 'workOrderFiles',                ep: '/management/1/workOrderFiles',             query: { workOrderId: WORK_ORDER_ID } },
    { label: 'workOrderDocuments',            ep: '/management/1/workOrderDocuments',         query: { workOrderId: WORK_ORDER_ID } },

    // 2. Nested-by-id REST shape.
    { label: 'workOrders/:id/attachments',    ep: `/management/1/workOrders/${WORK_ORDER_ID}/attachments` },
    { label: 'workOrders/:id/photos',         ep: `/management/1/workOrders/${WORK_ORDER_ID}/photos` },
    { label: 'workOrders/:id/files',          ep: `/management/1/workOrders/${WORK_ORDER_ID}/files` },

    // 3. Notes — attachments might be associated to notes, not WOs.
    { label: 'workOrderNotes',                ep: '/management/1/workOrderNotes',             query: { workOrderId: WORK_ORDER_ID } },

    // 4. Generic collections scoped by work order.
    { label: 'attachments?workOrderId',       ep: '/management/1/attachments',                query: { workOrderId: WORK_ORDER_ID } },
    { label: 'files?workOrderId',             ep: '/management/1/files',                      query: { workOrderId: WORK_ORDER_ID } },
    { label: 'photos?workOrderId',            ep: '/management/1/photos',                     query: { workOrderId: WORK_ORDER_ID } },
    { label: 'pictures?workOrderId',          ep: '/management/1/pictures',                   query: { workOrderId: WORK_ORDER_ID } },
  ]

  const results: ProbeResult[] = []
  for (const p of probes) {
    console.error(`[probe] ${p.ep}  ${JSON.stringify(p.query ?? {})}`)
    results.push(await probe(token, p.label, p.ep, p.query ?? {}))
  }

  // Summary line per probe so the eye can scan quickly.
  console.error('')
  console.error('─── summary ───')
  for (const r of results) {
    const tag = r.ok ? 'OK ' : '   '
    console.error(`${tag} ${String(r.status ?? 'ERR').padStart(3)}  rows=${String(r.rowCount ?? '-').padStart(3)}  ${r.label}`)
  }
  console.error('')

  console.log(JSON.stringify({
    startedAt:    new Date().toISOString(),
    workOrderId:  WORK_ORDER_ID,
    apiBase:      API_BASE,
    results,
  }, null, 2))
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
