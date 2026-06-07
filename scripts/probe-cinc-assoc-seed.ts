// =====================================================================
// scripts/probe-cinc-assoc-seed.ts
//
// Read-only. Answers: "which associations still need a first work order
// created in CINC before MAIA can sync its work orders?"
//
// For every association that has a MAIA work-order ticket, we check:
//   1. workOrders?assocCode=X  → does CINC return ≥1 WO? (this is what
//      createLinkedWorkOrder's findAssocIdByCode relies on — zero WOs
//      means "Cannot resolve AssocId" on create)
//   2. associations?assocCode=X → does the /associations endpoint expose
//      an AssocId directly? (if yes, the manual seed could be replaced
//      by a code fix — reported as FYI)
//
// Also reports how many of that association's MAIA work orders are still
// unsynced (no cinc_workorder_id).
//
// USAGE:  npx tsx scripts/probe-cinc-assoc-seed.ts
//
// All CINC calls are GETs. No writes. Loads creds from .env.local.
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

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

const CLIENT_ID     = process.env.CINC_CLIENT_ID
const CLIENT_SECRET = process.env.CINC_CLIENT_SECRET
const SCOPE         = process.env.CINC_SCOPE ?? 'cincapi.all'
const orDefault     = (v: string | undefined, d: string) => (v && v.trim()) ? v : d
const AUTH_URL      = orDefault(process.env.CINC_AUTH_URL, 'https://identityserver.cincsys.io/connect/token')
const API_BASE      = orDefault(process.env.CINC_API_BASE, 'https://PMITFP.cincsys.com/api').replace(/\/$/, '')
// Prefer the direct project URL; NEXT_PUBLIC_SUPABASE_URL is a www proxy
// that only rewrites browser paths, not the REST API.
const SUPABASE_URL  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CINC_CLIENT_ID / CINC_CLIENT_SECRET in .env.local'); process.exit(1)
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY in .env.local'); process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// --- CINC auth + GET ---
let _token: string | null = null
async function getToken(): Promise<string> {
  if (_token) return _token
  const body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, scope: SCOPE,
  })
  const res = await fetch(AUTH_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  })
  if (!res.ok) { console.error(`Token failed ${res.status}: ${await res.text()}`); process.exit(1) }
  _token = ((await res.json()) as { access_token: string }).access_token
  return _token
}

async function cincGet<T>(path: string, query: Record<string, string>): Promise<T | null> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } })
  if (!res.ok) return null
  return res.status === 204 ? null : ((await res.json()) as T)
}

interface WO { WorkOrderId?: number; AssocId?: number; AssocCode?: string }
interface AssocMeta { AssocId?: number; AssociationIdLink?: string | null; Associationname?: string | null; Numberofunits?: number | null }

async function main() {
  // 1. Every MAIA work-order ticket with an association_code.
  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('association_code, cinc_workorder_id')
    .eq('type', 'work_order')
    .not('association_code', 'is', null)
  if (error) { console.error('Supabase query failed:', error.message); process.exit(1) }

  // Group by association_code → total / unsynced counts.
  const byCode = new Map<string, { total: number; unsynced: number }>()
  for (const t of tickets ?? []) {
    const code = String(t.association_code).toUpperCase()
    const g = byCode.get(code) ?? { total: 0, unsynced: 0 }
    g.total++
    if (!t.cinc_workorder_id) g.unsynced++
    byCode.set(code, g)
  }

  const codes = [...byCode.keys()].sort()
  console.log(`\nMAIA has work-order tickets for ${codes.length} associations. Probing CINC (read-only)…\n`)

  const needSeed: { code: string; name: string; unsynced: number; metaAssocId: number | null }[] = []
  const ready:    { code: string; assocId: number; unsynced: number }[] = []

  for (const code of codes) {
    const g = byCode.get(code)!
    // findAssocIdByCode equivalent — the gate createLinkedWorkOrder uses.
    const wos  = (await cincGet<WO[]>('/management/1/workOrders', { assocCode: code })) ?? []
    const woAssocId = wos.find(w => (w.AssocCode ?? '').toUpperCase() === code && w.AssocId)?.AssocId ?? null
    // /associations fallback — does CINC expose AssocId without any WO?
    const metaList = (await cincGet<AssocMeta[]>('/management/1/associations', { assocCode: code })) ?? []
    const meta = metaList.find(m => (m.AssociationIdLink ?? '').toUpperCase() === code) ?? metaList[0]
    const metaAssocId = meta?.AssocId ?? null
    const name = meta?.Associationname ?? code

    if (woAssocId) {
      ready.push({ code, assocId: woAssocId, unsynced: g.unsynced })
    } else {
      needSeed.push({ code, name, unsynced: g.unsynced, metaAssocId })
    }
    console.log(`  ${code.padEnd(14)} WOs-in-CINC=${String(wos.length).padStart(3)}  woAssocId=${String(woAssocId ?? '—').padStart(6)}  assocEndpointId=${String(metaAssocId ?? '—').padStart(6)}  MAIA-unsynced=${g.unsynced}`)
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log(`READY (CINC already has ≥1 WO → MAIA can sync): ${ready.length}`)
  console.log(`NEED A FIRST WO seeded in CINC: ${needSeed.length}`)
  console.log(`${'='.repeat(72)}\n`)

  if (needSeed.length) {
    console.log('Create one work order in CINC for EACH of these, then re-run sync:\n')
    for (const n of needSeed) {
      const fyi = n.metaAssocId ? ` (AssocId ${n.metaAssocId} IS exposed by /associations — a code fix could auto-resolve this)` : ''
      console.log(`  • ${n.code}  "${n.name}"  — ${n.unsynced} MAIA WO(s) waiting${fyi}`)
    }
    const allExposed = needSeed.every(n => n.metaAssocId)
    if (allExposed) {
      console.log(`\n  NOTE: every association above already returns an AssocId from the`)
      console.log(`  /associations endpoint. Patching findAssocIdByCode to fall back to it`)
      console.log(`  would remove the manual-seed requirement entirely.`)
    }
  } else {
    console.log('🎉 Nothing to seed — every association with MAIA work orders resolves in CINC.')
  }
  console.log('')
}

main().catch(e => { console.error(e); process.exit(1) })
