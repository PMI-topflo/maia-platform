// =====================================================================
// scripts/probe-rentvine.ts
//
// Read-only discovery probe for the Rentvine API. Hits a list of candidate
// endpoints (work orders, notes, messages, vendors, properties, webhooks),
// records the response shape with PII redacted, and writes a structured
// JSON report. Used to map our `tickets`/`ticket_messages` schema to the
// real Rentvine field names before writing the integration client.
//
// USAGE:
//   npx tsx scripts/probe-rentvine.ts > probe-output.json
//
// Loads RENTVINE_BASE_URL / RENTVINE_ACCESS_KEY / RENTVINE_SECRET from
// .env.local. Every call is a GET — no writes, no mutations. PII fields
// (name, email, phone, address) are redacted before printing.
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- Load .env.local (same parser as bootstrap-manxi-folders.ts) ---
try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  let i = 0
  const len = content.length
  while (i < len) {
    while (i < len && (content[i] === '\n' || content[i] === '\r')) i++
    if (i >= len) break
    if (content[i] === '#') { while (i < len && content[i] !== '\n') i++; continue }
    let keyEnd = i
    while (keyEnd < len && content[keyEnd] !== '=' && content[keyEnd] !== '\n') keyEnd++
    if (content[keyEnd] !== '=') { i = keyEnd + 1; continue }
    const key = content.slice(i, keyEnd).trim()
    i = keyEnd + 1
    let val = ''
    if (i < len && (content[i] === '"' || content[i] === "'")) {
      const q = content[i++]
      while (i < len) {
        if (content[i] === '\\' && i + 1 < len) { val += content[i + 1]; i += 2; continue }
        if (content[i] === q) { i++; break }
        val += content[i++]
      }
    } else {
      while (i < len && content[i] !== '\n' && content[i] !== '\r') val += content[i++]
      val = val.trim()
    }
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* fall through to env */ }

const BASE   = process.env.RENTVINE_BASE_URL
const KEY    = process.env.RENTVINE_ACCESS_KEY
const SECRET = process.env.RENTVINE_SECRET

if (!BASE || !KEY || !SECRET) {
  console.error('Missing RENTVINE_BASE_URL / RENTVINE_ACCESS_KEY / RENTVINE_SECRET in .env.local')
  process.exit(1)
}

const AUTH = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64')

// --- PII redaction ---
const PII_KEYS = new Set([
  'name', 'fullname', 'full_name', 'firstname', 'first_name', 'lastname', 'last_name',
  'email', 'emailaddress', 'email_address',
  'phone', 'phonenumber', 'phone_number', 'mobile', 'cell',
  'address', 'street', 'street1', 'street2', 'addressline1', 'addressline2',
  'ssn', 'taxid', 'tax_id', 'ein',
  'description', 'notes', 'note', 'comment', 'comments', 'message', 'body',
])

function redactValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  const k = key.toLowerCase().replace(/[_-]/g, '')
  if (PII_KEYS.has(k) && typeof value === 'string') {
    return `<redacted:${typeof value} len=${value.length}>`
  }
  if (Array.isArray(value)) return value.slice(0, 2).map((v, idx) => redact(v, `${key}[${idx}]`))
  if (typeof value === 'object') return redact(value as Record<string, unknown>, key)
  if (typeof value === 'string' && value.length > 120) return value.slice(0, 120) + '…'
  return value
}

function redact(obj: unknown, parentKey = ''): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.slice(0, 2).map((v, idx) => redact(v, `${parentKey}[${idx}]`))
  if (typeof obj !== 'object') return obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = redactValue(k, v)
  return out
}

// --- Shape inspection: keys + types, recursive but shallow ---
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 3) return '...'
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array<empty>'
    return [`array<${value.length}>`, shapeOf(value[0], depth + 1)]
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shapeOf(v, depth + 1)
    }
    return out
  }
  return typeof value
}

interface ProbeResult {
  endpoint:    string
  method:      'GET'
  status:      number | null
  ok:          boolean
  contentType: string | null
  shape:       unknown
  sample:      unknown
  error:       string | null
  hint:        string
}

async function probe(path: string, hint: string): Promise<ProbeResult> {
  const url = `${BASE}${path.startsWith('/') ? path : '/' + path}`
  try {
    const res = await fetch(url, {
      method:  'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
    })
    const contentType = res.headers.get('content-type')
    let body: unknown = null
    let parseError: string | null = null
    try {
      body = contentType?.includes('json') ? await res.json() : await res.text()
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e)
    }
    return {
      endpoint:    path,
      method:      'GET',
      status:      res.status,
      ok:          res.ok,
      contentType,
      shape:       res.ok ? shapeOf(body) : null,
      sample:      res.ok ? redact(body) : (typeof body === 'string' ? body.slice(0, 300) : redact(body)),
      error:       parseError,
      hint,
    }
  } catch (err) {
    return {
      endpoint:    path,
      method:      'GET',
      status:      null,
      ok:          false,
      contentType: null,
      shape:       null,
      sample:      null,
      error:       err instanceof Error ? err.message : String(err),
      hint,
    }
  }
}

// Pull a candidate id out of a list response (Rentvine seems to use mixed casing)
function extractId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const data = (body as { data?: unknown }).data
  const list = Array.isArray(data) ? data : Array.isArray(body) ? body : null
  if (!list || list.length === 0) return null
  const first = list[0] as Record<string, unknown>
  const candidates = ['workOrderID', 'workorderID', 'work_order_id', 'workOrderId', 'id', 'ID']
  for (const c of candidates) {
    if (first[c] != null) return String(first[c])
  }
  // Nested shape — sometimes Rentvine wraps as { workOrder: { ... } }
  for (const wrapKey of ['workOrder', 'workorder', 'work_order']) {
    const wrap = first[wrapKey] as Record<string, unknown> | undefined
    if (wrap) {
      for (const c of candidates) if (wrap[c] != null) return String(wrap[c])
    }
  }
  return null
}

async function main() {
  const report: { startedAt: string; base: string; results: ProbeResult[] } = {
    startedAt: new Date().toISOString(),
    base:      BASE!,
    results:   [],
  }

  // --- Discovery: work orders ---
  const woList = await probe('/workorders?limit=2', 'List work orders, see pagination + record shape')
  report.results.push(woList)
  const woId = woList.ok ? extractId(woList.sample) : null

  if (woId) {
    report.results.push(await probe(`/workorders/${woId}`,                'Single work order detail shape'))
    report.results.push(await probe(`/workorders/${woId}/notes`,          'Notes/comments on a work order'))
    report.results.push(await probe(`/workorders/${woId}/comments`,       'Alternate name for notes'))
    report.results.push(await probe(`/workorders/${woId}/messages`,       'Tenant↔vendor messages on a work order (key question)'))
    report.results.push(await probe(`/workorders/${woId}/communications`, 'Alternate name for messages'))
    report.results.push(await probe(`/workorders/${woId}/history`,        'Audit/event log shape'))
    report.results.push(await probe(`/workorders/${woId}/attachments`,    'File attachments on a work order'))
  } else {
    report.results.push({
      endpoint: '/workorders/:id/*', method: 'GET', status: null, ok: false,
      contentType: null, shape: null, sample: null,
      error: 'Skipped — no work order id discovered from /workorders list',
      hint: 'Either no work orders exist yet, or the list endpoint returned an unexpected shape',
    })
  }

  // --- Enums / metadata ---
  report.results.push(await probe('/workorders/statuses',   'Status enum values (open/in_progress/closed/etc.)'))
  report.results.push(await probe('/workorders/categories', 'Category enum values'))
  report.results.push(await probe('/workorders/priorities', 'Priority enum values'))

  // --- Top-level message feed (in case messages are not work-order-scoped) ---
  report.results.push(await probe('/messages?limit=5',       'Top-level messages feed — does it exist?'))
  report.results.push(await probe('/communications?limit=5', 'Top-level communications feed'))
  report.results.push(await probe('/conversations?limit=5',  'Top-level conversations feed'))

  // --- Related entities we will need to map to MAIA records ---
  report.results.push(await probe('/vendors?limit=2',     'Vendor record shape — for vendor_email mapping'))
  report.results.push(await probe('/properties?limit=2',  'Property/unit record shape — for association mapping'))
  report.results.push(await probe('/units?limit=2',       'Alternate naming for properties'))

  // --- Webhooks: can we subscribe instead of polling? ---
  report.results.push(await probe('/webhooks',              'Existing webhook subscriptions'))
  report.results.push(await probe('/webhooks/events',       'Available event types'))
  report.results.push(await probe('/api/webhooks',          'Alternate webhook path'))

  // --- Rate limit / API root sniff ---
  report.results.push(await probe('/',                'API root (may return 404, that is informative)'))
  report.results.push(await probe('/health',          'Health check / version stamp'))

  console.log(JSON.stringify(report, null, 2))

  const failures = report.results.filter(r => !r.ok).length
  console.error(`\nProbed ${report.results.length} endpoints — ${report.results.length - failures} ok, ${failures} failed/missing`)
}

main().catch(err => {
  console.error('Probe failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
