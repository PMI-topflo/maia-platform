// =====================================================================
// scripts/backfill-cinc-wo-details.ts
//
// One-time backfill: for every existing ticket with cinc_workorder_id,
// fetch the WO from CINC and populate work_order_details with the
// fields the inbound sync didn't used to capture (HoID, PropertyId,
// WorkLocationName, address, vendor, scheduled date, cost).
//
// Idempotent — safe to re-run. Each row is an upsert keyed on
// ticket_id, so successive runs just refresh the latest CINC view.
//
// USAGE:
//   npx tsx scripts/backfill-cinc-wo-details.ts            # dry run
//   npx tsx scripts/backfill-cinc-wo-details.ts --apply    # actually write
//   npx tsx scripts/backfill-cinc-wo-details.ts --apply --wo 96   # one WO
//
// Loads creds from .env.local. Requires SUPABASE_URL +
// SUPABASE_SERVICE_KEY + CINC_CLIENT_ID + CINC_CLIENT_SECRET.
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

// --- Load .env.local before importing any module that reads env ---
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

const APPLY      = process.argv.includes('--apply')
const SINGLE_WO  = (() => {
  const idx = process.argv.indexOf('--wo')
  if (idx < 0 || !process.argv[idx + 1]) return null
  const n = Number(process.argv[idx + 1])
  return Number.isFinite(n) && n > 0 ? String(n) : null
})()

async function main(): Promise<void> {
  // Dynamic imports so the .env.local loader above runs first.
  const { supabaseAdmin }          = await import('@/lib/supabase-admin')
  const { getWorkOrderById }       = await import('@/lib/integrations/cinc')
  const { upsertWorkOrderDetails } = await import('@/lib/integrations/cinc-inbound')

  console.error(`[backfill] mode=${APPLY ? 'APPLY' : 'DRY RUN'}${SINGLE_WO ? ` (single WO ${SINGLE_WO})` : ''}`)

  let query = supabaseAdmin
    .from('tickets')
    .select('id, cinc_workorder_id, subject')
    .not('cinc_workorder_id', 'is', null)
    .order('id', { ascending: true })

  if (SINGLE_WO) query = query.eq('cinc_workorder_id', SINGLE_WO)

  const { data: tickets, error } = await query
  if (error) throw new Error(`tickets query failed: ${error.message}`)
  if (!tickets || tickets.length === 0) {
    console.error('[backfill] no CINC tickets matched — nothing to do')
    return
  }

  console.error(`[backfill] found ${tickets.length} CINC ticket(s)`)

  let ok    = 0
  let miss  = 0
  let errs  = 0

  for (const t of tickets) {
    const cincId = Number(t.cinc_workorder_id)
    if (!Number.isFinite(cincId) || cincId <= 0) {
      console.error(`  - ticket ${t.id}: skip — cinc_workorder_id "${t.cinc_workorder_id}" is not a positive integer`)
      errs++
      continue
    }

    let wo
    try {
      wo = await getWorkOrderById(cincId)
    } catch (err) {
      console.error(`  - ticket ${t.id} / WO ${cincId}: CINC fetch failed: ${(err as Error).message}`)
      errs++
      continue
    }

    if (!wo) {
      console.error(`  - ticket ${t.id} / WO ${cincId}: CINC returned no WO (deleted?)`)
      miss++
      continue
    }

    const preview = [
      `HoID=${wo.HoID ?? '-'}`,
      `PropertyId=${wo.PropertyId ?? '-'}`,
      `Loc="${wo.WorkLocationName ?? '-'}"`,
      `Vendor="${wo.Vendor ?? '-'}"`,
    ].join(' ')

    if (!APPLY) {
      console.error(`  - ticket ${t.id} / WO ${cincId}: ${preview}  [dry run]`)
      ok++
      continue
    }

    try {
      await upsertWorkOrderDetails(t.id as number, wo)
      console.error(`  - ticket ${t.id} / WO ${cincId}: ${preview}  ✓`)
      ok++
    } catch (err) {
      console.error(`  - ticket ${t.id} / WO ${cincId}: upsert failed: ${(err as Error).message}`)
      errs++
    }
  }

  console.error('')
  console.error(`[backfill] done. ok=${ok}  missing=${miss}  errors=${errs}`)
  if (!APPLY) console.error('[backfill] no rows written — re-run with --apply to commit')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
