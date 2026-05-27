// =====================================================================
// scripts/probe-cinc.ts
//
// Read-only discovery probe for the CINC API. Walks a grid of base-URL
// variants (.io vs .com, with and without /api prefix, tenant-prefixed)
// and reports auth + endpoint status for each. Used to diagnose 403/404
// responses without trial-and-error on Vercel.
//
// USAGE:
//   npx tsx scripts/probe-cinc.ts > probe-cinc-output.json
//
// Loads CINC_CLIENT_ID / CINC_CLIENT_SECRET / CINC_AUTH_URL /
// CINC_API_BASE / CINC_SCOPE from .env.local. If you don't have them
// locally, pull from Vercel first:
//   vercel env pull .env.local --environment=preview
//
// Every call is a GET — no writes, no mutations. PII redacted before
// printing.
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- Load .env.local (simple line-by-line parser) ---
try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  // Strip BOM if present
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

const CLIENT_ID     = process.env.CINC_CLIENT_ID
const CLIENT_SECRET = process.env.CINC_CLIENT_SECRET
const SCOPE         = process.env.CINC_SCOPE     ?? 'cincapi.all'
const CONFIGURED_AUTH = process.env.CINC_AUTH_URL ?? ''
const CONFIGURED_BASE = process.env.CINC_API_BASE ?? ''

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(JSON.stringify({
    error: 'missing-credentials',
    message: 'CINC_CLIENT_ID / CINC_CLIENT_SECRET not set in .env.local',
    hint: 'Run: vercel env pull .env.local --environment=preview',
  }, null, 2))
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────
// Auth URL candidates (.io and .com)
// ─────────────────────────────────────────────────────────────────────
const AUTH_CANDIDATES = Array.from(new Set([
  CONFIGURED_AUTH,
  'https://identityserver.cincsys.io/connect/token',
  'https://identity.cincsys.io/connect/token',
  'https://identityserver.cincsys.com/connect/token',
  'https://identity.cincsys.com/connect/token',
].filter(Boolean)))

// ─────────────────────────────────────────────────────────────────────
// API base candidates
// ─────────────────────────────────────────────────────────────────────
const BASE_CANDIDATES = Array.from(new Set([
  CONFIGURED_BASE,
  'https://integration.cincsys.io/api',
  'https://integration.cincsys.io',
  'https://integration.cincsys.com/api',
  'https://integration.cincsys.com',
  // Tenant-prefixed (PMITFP is a guess based on previous chat — adjust if you know the real tenant slug)
  'https://PMITFP.cincsys.com/api',
  'https://PMITFP.cincsys.io/api',
].filter(Boolean))).map(b => b.replace(/\/$/, ''))

// ─────────────────────────────────────────────────────────────────────
// Endpoints to probe under each base
// ─────────────────────────────────────────────────────────────────────
const ENDPOINTS = [
  '/management/1/workOrderStatuses',
  '/management/1/workOrderTypes',
  '/management/1/workOrders?pageSize=1',
]

// ─────────────────────────────────────────────────────────────────────
// PII redaction
// ─────────────────────────────────────────────────────────────────────
const PII_KEYS = new Set([
  'name','fullname','full_name','firstname','first_name','lastname','last_name',
  'email','emailaddress','email_address',
  'phone','phonenumber','phone_number','mobile','cell',
  'address','street','street1','street2',
  'description','notes','note','comment','comments','message','body',
])
function redact(obj: unknown, key = ''): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.slice(0, 2).map((v, idx) => redact(v, `${key}[${idx}]`))
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = redact(v, k)
    return out
  }
  const k = key.toLowerCase().replace(/[_-]/g, '')
  if (PII_KEYS.has(k) && typeof obj === 'string') return `<redacted:string len=${obj.length}>`
  if (typeof obj === 'string' && obj.length > 200) return obj.slice(0, 200) + '…'
  return obj
}

// ─────────────────────────────────────────────────────────────────────
// Try each auth candidate until one succeeds
// ─────────────────────────────────────────────────────────────────────
interface AuthAttempt {
  authUrl:    string
  status:     number | null
  ok:         boolean
  error:      string | null
  body:       unknown
}

async function tryAuth(authUrl: string): Promise<AuthAttempt & { token?: string }> {
  try {
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope:         SCOPE,
    })
    const res = await fetch(authUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 300) } }
    if (res.ok && typeof parsed === 'object' && parsed && 'access_token' in (parsed as object)) {
      const token = (parsed as { access_token: string }).access_token
      return {
        authUrl,
        status:  res.status,
        ok:      true,
        error:   null,
        body:    { token_received: true, expires_in: (parsed as { expires_in?: number }).expires_in ?? null },
        token,
      }
    }
    return { authUrl, status: res.status, ok: false, error: null, body: parsed }
  } catch (err) {
    return { authUrl, status: null, ok: false, error: (err as Error).message, body: null }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Probe a single endpoint with a token
// ─────────────────────────────────────────────────────────────────────
interface ProbeResult {
  url:         string
  status:      number | null
  contentType: string | null
  ok:          boolean
  isJson:      boolean
  isHtml:      boolean
  sample:      unknown
  error:       string | null
}

async function probe(url: string, token: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      method:  'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      },
    })
    const ct = res.headers.get('content-type') ?? ''
    const text = await res.text()
    let sample: unknown
    let isJson = false
    if (ct.includes('json')) {
      try { sample = redact(JSON.parse(text)); isJson = true }
      catch { sample = text.slice(0, 200) }
    } else {
      sample = text.slice(0, 200)
    }
    return {
      url,
      status:      res.status,
      contentType: ct || null,
      ok:          res.ok,
      isJson,
      isHtml:      ct.includes('html'),
      sample,
      error:       null,
    }
  } catch (err) {
    return { url, status: null, contentType: null, ok: false, isJson: false, isHtml: false, sample: null, error: (err as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const report: Record<string, unknown> = {
    startedAt:      new Date().toISOString(),
    configured: {
      auth: CONFIGURED_AUTH || '<unset, using defaults>',
      base: CONFIGURED_BASE || '<unset, using defaults>',
      scope: SCOPE,
    },
    authAttempts:   [] as AuthAttempt[],
    workingAuth:    null as string | null,
    probesByBase:   {} as Record<string, ProbeResult[]>,
  }

  // Step 1: try each auth candidate
  let token: string | null = null
  for (const authUrl of AUTH_CANDIDATES) {
    const attempt = await tryAuth(authUrl)
    const { token: t, ...rest } = attempt as AuthAttempt & { token?: string }
    ;(report.authAttempts as AuthAttempt[]).push(rest)
    if (attempt.ok && t) {
      token = t
      report.workingAuth = authUrl
      break
    }
  }

  if (!token) {
    report.terminatedAt = new Date().toISOString()
    report.outcome = 'no-auth-url-succeeded — all attempted CINC token endpoints rejected the credentials'
    console.log(JSON.stringify(report, null, 2))
    process.exit(0)
  }

  // Step 2: with the working token, probe each base × endpoint
  for (const base of BASE_CANDIDATES) {
    const results: ProbeResult[] = []
    for (const ep of ENDPOINTS) {
      const r = await probe(`${base}${ep}`, token)
      results.push(r)
    }
    ;(report.probesByBase as Record<string, ProbeResult[]>)[base] = results
  }

  report.finishedAt = new Date().toISOString()

  // Summary: which (base, endpoint) returned 2xx?
  const wins: Array<{ base: string; endpoint: string; status: number }> = []
  for (const [base, results] of Object.entries(report.probesByBase as Record<string, ProbeResult[]>)) {
    for (const r of results) {
      if (r.ok && r.status && r.status >= 200 && r.status < 300) {
        wins.push({ base, endpoint: r.url.replace(base, ''), status: r.status })
      }
    }
  }
  report.successfulCombinations = wins
  report.outcome = wins.length > 0
    ? `Found ${wins.length} working base+endpoint combination(s). See 'successfulCombinations'.`
    : 'auth worked, but ALL base+endpoint combinations returned non-2xx. CINC scope or tenant config issue — escalate to CINC support.'

  console.log(JSON.stringify(report, null, 2))
}

main().catch(err => {
  console.error(JSON.stringify({ error: 'probe-crashed', message: (err as Error).message, stack: (err as Error).stack }, null, 2))
  process.exit(1)
})
