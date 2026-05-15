// =====================================================================
// scripts/probe-cinc-homeowners.ts
//
// Read-only discovery script for the CINC homeowner / board endpoints.
// Hits the four endpoints we'd need for "import an association from
// CINC" and dumps PII-redacted JSON so we can see the exact field
// names before designing the import UI.
//
// USAGE:
//   npx tsx scripts/probe-cinc-homeowners.ts <ASSOC_CODE>
//   # e.g.
//   npx tsx scripts/probe-cinc-homeowners.ts ISLAND
//
// All calls are GETs — no writes, no mutations. PII (names, emails,
// phones, addresses) is redacted before printing so the output is
// safe to paste into a chat.
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

const ASSOC_CODE     = (process.argv[2] || '').toUpperCase()
const CLIENT_ID      = process.env.CINC_CLIENT_ID
const CLIENT_SECRET  = process.env.CINC_CLIENT_SECRET
const SCOPE          = process.env.CINC_SCOPE     ?? 'cincapi.all'
const orDefault      = (v: string | undefined, d: string) => (v && v.trim()) ? v : d
const AUTH_URL       = orDefault(process.env.CINC_AUTH_URL,  'https://identity.cincsys.com/connect/token')
const API_BASE       = orDefault(process.env.CINC_API_BASE,  'https://PMITFP.cincsys.com/api').replace(/\/$/, '')

if (!ASSOC_CODE) {
  console.error('Usage: npx tsx scripts/probe-cinc-homeowners.ts <ASSOC_CODE>')
  console.error('Example: npx tsx scripts/probe-cinc-homeowners.ts ISLAND')
  process.exit(1)
}
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CINC_CLIENT_ID / CINC_CLIENT_SECRET in .env.local')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────
// PII redaction — every key likely to contain personal data gets a
// "<redacted:string len=N>" sentinel instead of the actual value.
// Lets us share the shape without leaking real homeowner contacts.
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

function redact(obj: unknown, key = ''): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) {
    // Keep up to 3 sample items so we can see if all rows have the same shape.
    return obj.slice(0, 3).map((v, idx) => redact(v, `${key}[${idx}]`))
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = redact(v, k)
    return out
  }
  const k = key.toLowerCase().replace(/[_-]/g, '')
  if (PII_KEYS.has(k) && typeof obj === 'string' && obj.length > 0) {
    return `<redacted:string len=${obj.length}>`
  }
  if (typeof obj === 'string' && obj.length > 200) return obj.slice(0, 200) + '…'
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
// Probe an endpoint and return a summarized result
// ─────────────────────────────────────────────────────────────────────
interface ProbeResult {
  endpoint:    string
  url:         string
  status:      number | null
  ok:          boolean
  contentType: string | null
  rowCount:    number | null
  sample:      unknown
  error:       string | null
}

async function probe(token: string, endpoint: string, query: Record<string, string | number>): Promise<ProbeResult> {
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
      endpoint,
      url:         url.toString(),
      status:      res.status,
      ok:          res.ok,
      contentType: ct || null,
      rowCount,
      sample:      redact(parsed),
      error:       null,
    }
  } catch (err) {
    return {
      endpoint,
      url:         url.toString(),
      status:      null,
      ok:          false,
      contentType: null,
      rowCount:    null,
      sample:      null,
      error:       (err as Error).message,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Resolve assocId for the given assocCode (needed by some endpoints
// that don't take assocCode directly).
// ─────────────────────────────────────────────────────────────────────
async function findAssocId(token: string, assocCode: string): Promise<number | null> {
  const url = new URL(`${API_BASE}/management/1/associations`)
  url.searchParams.set('assocCode', assocCode)
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json() as Array<{ AssocId?: number; AssocCode?: string }>
    const hit = data.find(a => a.AssocCode?.toUpperCase() === assocCode.toUpperCase())
    return hit?.AssocId ?? null
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const token = await getToken()
  console.error('[probe] token OK')

  const assocId = await findAssocId(token, ASSOC_CODE)
  console.error(`[probe] AssocCode=${ASSOC_CODE} → AssocId=${assocId ?? '(not found)'}`)

  // Try every relevant endpoint with both assocCode and assocId
  // shaped queries — we don't know yet which one each accepts.
  const probes: Array<{ ep: string; query: Record<string, string | number> }> = [
    // 1. Single-association lookup
    { ep: '/management/1/associations', query: { assocCode: ASSOC_CODE } },

    // 2. All units + homeowners for the association — try both query shapes
    { ep: '/management/1/homeowners/associationWithProperty', query: { assocCode: ASSOC_CODE } },
    ...(assocId ? [{ ep: '/management/1/homeowners/associationWithProperty', query: { assocId } as Record<string, string | number> }] : []),
    { ep: '/management/2/homeowners/associationWithProperty', query: { assocCode: ASSOC_CODE } },

    // 3. Board members (active associations)
    { ep: '/management/1/associations/boardMembers', query: { assocCode: ASSOC_CODE } },
    ...(assocId ? [{ ep: '/management/1/associations/boardMembers', query: { assocId } as Record<string, string | number> }] : []),

    // 4. Homeowner lookup (no params — see how strict it is)
    { ep: '/management/1/homeowners/homeownerlookup', query: { assocCode: ASSOC_CODE } },
  ]

  const results: ProbeResult[] = []
  for (const p of probes) {
    console.error(`[probe] ${p.ep}  ${JSON.stringify(p.query)}`)
    results.push(await probe(token, p.ep, p.query))
  }

  console.log(JSON.stringify({
    startedAt:  new Date().toISOString(),
    assocCode:  ASSOC_CODE,
    assocId,
    apiBase:    API_BASE,
    results,
  }, null, 2))
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
