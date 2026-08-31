// =====================================================================
// scripts/spot-check-car-registrations.ts
//
// Portfolio-wide spot-check for the MANXI 613 car-registration bug
// (docs/SESSION-HANDOFF.md, 2026-08-22 entry): quickDocScanDetailed used
// Haiku until that session, and on a real Florida vehicle-registration
// photo Haiku deterministically misread it as "certificate of use" and
// invented an expiration date not printed anywhere on the document (wrong
// 6/6 runs across two image variants before the fix). Switched to Sonnet,
// which read the same document correctly 3/3. Every car_registration
// document scanned BEFORE that switch may carry a wrong or blank
// expiration_date, and there is no error-vs-empty distinction stored on
// the row itself — this has to be an actual re-scan-and-compare pass, a
// SQL query cannot find these.
//
// Re-scans every application_documents row with doc_key='car_registration'
// created before the cutoff, using the same Sonnet-backed
// quickDocScanDetailed the live "Read expiration" re-scan button uses
// (lib/quick-doc-classify.ts, app/api/admin/pre-apply/[id]/doc/[docId]/rescan).
// Reports every discrepancy; only WRITES on --apply, and even then never
// blanks an existing expiration_date the way the live single-doc re-scan
// endpoint doesn't either — a new scan that reads no expiration is
// reported as a mismatch needing a human look, not auto-cleared.
//
// USAGE:
//   npx tsx scripts/spot-check-car-registrations.ts                  # dry run, full portfolio
//   npx tsx scripts/spot-check-car-registrations.ts --limit 20       # dry run, first 20 docs
//   npx tsx scripts/spot-check-car-registrations.ts --apply          # write corrected dates
//   npx tsx scripts/spot-check-car-registrations.ts --apply --doc <id>  # single document
//
// Loads creds from .env.local. Requires SUPABASE_URL + SUPABASE_SERVICE_KEY
// + ANTHROPIC_API_KEY. Idempotent — safe to re-run; --apply only ever sets
// expiration_date when the new scan actually found one, never clears it.
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

const APPLY = process.argv.includes('--apply')
const SINGLE_DOC = (() => {
  const idx = process.argv.indexOf('--doc')
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null
})()
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit')
  if (idx < 0 || !process.argv[idx + 1]) return null
  const n = Number(process.argv[idx + 1])
  return Number.isFinite(n) && n > 0 ? n : null
})()

// Sonnet replaced Haiku for quickDocScanDetailed during the 2026-08-22
// session (docs/SESSION-HANDOFF.md). No finer-grained commit timestamp is
// resolvable in this clone's history, so this is deliberately conservative
// — anything created on or before 2026-08-22 is treated as suspect rather
// than risk missing real Haiku-era documents by cutting off too early.
const CUTOFF = '2026-08-23T00:00:00Z'

async function main(): Promise<void> {
  // Dynamic imports so the .env.local loader above runs first.
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { quickDocScanDetailed } = await import('@/lib/quick-doc-classify')
  const { INTAKE_BUCKET } = await import('@/lib/preapply')

  console.error(`[spot-check] mode=${APPLY ? 'APPLY' : 'DRY RUN'}${SINGLE_DOC ? ` (single doc ${SINGLE_DOC})` : ''}${LIMIT ? ` (limit ${LIMIT})` : ''}`)
  console.error(`[spot-check] cutoff: documents created before ${CUTOFF}`)

  let query = supabaseAdmin
    .from('application_documents')
    .select('id, application_id, doc_key, storage_path, filename, mime_type, expiration_date, no_expiration, created_at')
    .eq('doc_key', 'car_registration')
    .order('created_at', { ascending: true })

  if (SINGLE_DOC) {
    query = query.eq('id', SINGLE_DOC)
  } else {
    query = query.lt('created_at', CUTOFF)
  }
  if (LIMIT) query = query.limit(LIMIT)

  const { data: docs, error } = await query
  if (error) throw new Error(`application_documents query failed: ${error.message}`)
  if (!docs || docs.length === 0) {
    console.error('[spot-check] no matching car_registration documents — nothing to do')
    return
  }
  console.error(`[spot-check] found ${docs.length} car_registration document(s) to check`)

  // Batch-resolve association/unit context for readable output.
  const appIds = [...new Set(docs.map((d: { application_id: string | null }) => d.application_id).filter((id: string | null): id is string => !!id))]
  const { data: apps } = await supabaseAdmin
    .from('listing_applications')
    .select('id, association_code, unit_label')
    .in('id', appIds)
  const appById = new Map<string, { association_code: string | null; unit_label: string | null }>(
    (apps ?? []).map((a: { id: string; association_code: string | null; unit_label: string | null }) =>
      [a.id, { association_code: a.association_code, unit_label: a.unit_label }])
  )

  let matched = 0
  let mismatched = 0
  let scanFailed = 0
  let skippedNoExpFlag = 0
  let skippedNoFile = 0
  let applied = 0

  for (const doc of docs) {
    const ctx = appById.get(doc.application_id)
    const label = `doc ${doc.id} (${ctx?.association_code ?? '?'} ${ctx?.unit_label ?? '?'}, created ${String(doc.created_at).slice(0, 10)})`

    if (doc.no_expiration) {
      console.error(`  - ${label}: skip — marked "does not expire" by staff, not overriding a decision`)
      skippedNoExpFlag++
      continue
    }
    if (!doc.storage_path) {
      console.error(`  - ${label}: skip — no stored file (Drive-link-only or missing)`)
      skippedNoFile++
      continue
    }

    const dl = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(doc.storage_path))
    if (dl.error || !dl.data) {
      console.error(`  - ${label}: FILE READ FAILED — ${dl.error?.message ?? 'missing'}`)
      scanFailed++
      continue
    }
    const buf = Buffer.from(await dl.data.arrayBuffer())

    const scan = await quickDocScanDetailed(buf, (doc.mime_type as string | null) ?? 'application/pdf')
    if (!scan.ok) {
      console.error(`  - ${label}: SCAN FAILED — ${scan.error ?? 'unknown error'} (stored expiration_date: ${doc.expiration_date ?? 'null'})`)
      scanFailed++
      continue
    }

    const stored = doc.expiration_date ?? null
    const found = scan.expiration ?? null

    if (stored === found) {
      matched++
      continue
    }

    mismatched++
    const misreadLabel = scan.label !== 'vehicle registration' ? ` [re-scan also labeled it "${scan.label}", not "vehicle registration" — check the file itself]` : ''
    console.error(`  - ${label}: MISMATCH — stored="${stored ?? 'null'}"  rescanned="${found ?? 'null'}"${misreadLabel}`)

    if (APPLY && found) {
      const { error: upErr } = await supabaseAdmin
        .from('application_documents')
        .update({ expiration_date: found })
        .eq('id', doc.id)
      if (upErr) {
        console.error(`      write failed: ${upErr.message}`)
      } else {
        console.error(`      -> corrected to ${found}`)
        applied++
      }
    } else if (APPLY && !found) {
      console.error(`      -> NOT auto-cleared: re-scan found no expiration but one was stored — needs a human look at the actual file`)
    }
  }

  console.error('')
  console.error(`[spot-check] done. matched=${matched}  mismatched=${mismatched}  scan_failed=${scanFailed}  skipped_no_exp_flag=${skippedNoExpFlag}  skipped_no_file=${skippedNoFile}${APPLY ? `  corrected=${applied}` : ''}`)
  if (!APPLY && mismatched > 0) console.error('[spot-check] no rows written — re-run with --apply to correct the mismatches above')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
