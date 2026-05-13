// =====================================================================
// scripts/backfill-cinc-timestamps.ts
//
// One-time backfill: fix CINC-sourced timestamps that were stored with
// a 4-hour shift because the inbound sync used to parse CINC's naive
// (tenant-local Eastern) strings as UTC.
//
// Strategy: re-fetch each MAIA ticket that has a cinc_workorder_id from
// CINC, derive the correct UTC ISO timestamps using the same logic the
// live sync now uses, and UPDATE the rows where the stored value
// differs by more than 1 second.
//
// Dry-run by default. Pass --apply to actually write.
//
// USAGE:
//   npx tsx scripts/backfill-cinc-timestamps.ts          # dry run
//   npx tsx scripts/backfill-cinc-timestamps.ts --apply  # write changes
//
// Requires .env.local with CINC_CLIENT_ID, CINC_CLIENT_SECRET,
// SUPABASE_URL, SUPABASE_SERVICE_KEY. Pull from Vercel first if needed:
//   vercel env pull .env.local --environment=preview
// =====================================================================

import { readFileSync } from 'fs'
import { resolve }      from 'path'
import { createClient } from '@supabase/supabase-js'

// --- Load .env.local (simple line-by-line parser) ---
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

const APPLY            = process.argv.includes('--apply')
const CLIENT_ID        = process.env.CINC_CLIENT_ID
const CLIENT_SECRET    = process.env.CINC_CLIENT_SECRET
const SCOPE            = process.env.CINC_SCOPE     ?? 'cincapi.all'
const AUTH_URL         = process.env.CINC_AUTH_URL  ?? 'https://identity.cincsys.com/connect/token'
const API_BASE         = (process.env.CINC_API_BASE ?? 'https://PMITFP.cincsys.com/api').replace(/\/$/, '')
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_KEY

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CINC_CLIENT_ID / CINC_CLIENT_SECRET in .env.local')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)

// ─────────────────────────────────────────────────────────────────────
// CINC timestamp parser — kept in sync with lib/integrations/cinc-inbound.ts
// ─────────────────────────────────────────────────────────────────────
const CINC_TENANT_TZ = 'America/New_York'

function parseCincTimestamp(raw: string | undefined | null): string | null {
  if (!raw) return null
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const iso   = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const asUtc = new Date(iso + 'Z')
  if (isNaN(asUtc.getTime())) return null

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CINC_TENANT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(asUtc).map(p => [p.type, p.value]))
  const easternWallAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  const offsetMs = easternWallAsUtc - asUtc.getTime()
  return new Date(asUtc.getTime() - offsetMs).toISOString()
}

// ─────────────────────────────────────────────────────────────────────
// CINC auth + minimal API client
// ─────────────────────────────────────────────────────────────────────
let _token: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.token
  const res = await fetch(AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope:         SCOPE,
    }).toString(),
  })
  if (!res.ok) throw new Error(`CINC token failed (${res.status}): ${await res.text()}`)
  const data = await res.json() as { access_token: string; expires_in?: number }
  _token = { token: data.access_token, expiresAt: Date.now() + ((data.expires_in ?? 3600) * 1000) }
  return _token.token
}

interface CincNote { NoteId: number; NoteCreatedDate: string }
interface CincWorkOrder {
  WorkOrderId: number
  DueDate?:    string
  Notes?:      CincNote[]
}

async function getWorkOrderById(workOrderId: number): Promise<CincWorkOrder | null> {
  const url = `${API_BASE}/management/1/workOrders?workOrderId=${workOrderId}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    console.error(`  ! getWorkOrderById(${workOrderId}) failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
    return null
  }
  const list = await res.json() as CincWorkOrder[]
  return list.find(w => w.WorkOrderId === workOrderId) ?? null
}

// ─────────────────────────────────────────────────────────────────────
// Comparison: equal if within 1 second (avoid spurious updates from
// rounding / floating-point representations)
// ─────────────────────────────────────────────────────────────────────
function timesEqual(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 1000
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (read-only — pass --apply to write)'}`)

  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('id, cinc_workorder_id, due_at')
    .not('cinc_workorder_id', 'is', null)
  if (error) throw new Error(`tickets fetch failed: ${error.message}`)
  console.log(`Found ${tickets?.length ?? 0} tickets with cinc_workorder_id\n`)

  let ticketsChecked  = 0
  let dueDatesFixed   = 0
  let notesChecked    = 0
  let notesFixed      = 0

  for (const t of (tickets ?? [])) {
    ticketsChecked++
    const woId = Number(t.cinc_workorder_id)
    if (!Number.isFinite(woId)) continue

    const wo = await getWorkOrderById(woId)
    if (!wo) continue

    // --- due_at ---
    const correctDue = parseCincTimestamp(wo.DueDate)
    if (!timesEqual(t.due_at, correctDue)) {
      console.log(`ticket ${t.id} (WO ${woId}): due_at  ${t.due_at} → ${correctDue}`)
      if (APPLY) {
        const { error: uErr } = await supabase
          .from('tickets')
          .update({ due_at: correctDue })
          .eq('id', t.id)
        if (uErr) console.error(`  ! update failed: ${uErr.message}`)
      }
      dueDatesFixed++
    }

    // --- ticket_messages.created_at for each CINC note ---
    for (const note of (wo.Notes ?? [])) {
      notesChecked++
      const externalId = String(note.NoteId)
      const { data: msg } = await supabase
        .from('ticket_messages')
        .select('id, created_at')
        .eq('ticket_id',  t.id)
        .eq('channel',    'internal')
        .eq('external_id', externalId)
        .maybeSingle()
      if (!msg) continue

      const correctCreated = parseCincTimestamp(note.NoteCreatedDate)
      if (correctCreated && !timesEqual(msg.created_at, correctCreated)) {
        console.log(`msg ${msg.id} (note ${externalId}): created_at  ${msg.created_at} → ${correctCreated}`)
        if (APPLY) {
          const { error: uErr } = await supabase
            .from('ticket_messages')
            .update({ created_at: correctCreated })
            .eq('id', msg.id)
          if (uErr) console.error(`  ! update failed: ${uErr.message}`)
        }
        notesFixed++
      }
    }
  }

  console.log(`\nSummary:`)
  console.log(`  tickets checked:        ${ticketsChecked}`)
  console.log(`  due_at fixes ${APPLY ? 'applied' : 'pending'}:  ${dueDatesFixed}`)
  console.log(`  notes checked:          ${notesChecked}`)
  console.log(`  note fixes ${APPLY ? 'applied' : 'pending'}:    ${notesFixed}`)
  if (!APPLY && (dueDatesFixed > 0 || notesFixed > 0)) {
    console.log(`\nRe-run with --apply to write these changes.`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
