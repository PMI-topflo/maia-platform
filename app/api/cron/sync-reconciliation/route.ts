// =====================================================================
// app/api/cron/sync-reconciliation/route.ts
//
// Hourly Vercel cron. Sweeps every active association and pulls 60
// days of GL transactions for each bank account's Cash GL — covers
// ALL bank activity (assessment income, vendor payments, transfers,
// fees) whether MAIA pushed the underlying invoice or not.
//
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncReconciliationForAssoc, type ReconSyncStats } from '@/lib/bank-reconciliation-sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300  // sweep covers ~25 assocs × ~2-5 bank accounts each — can take a few minutes

export async function GET(req: Request) {
  // Vercel cron auth — token is sent in the Authorization header.
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('associations')
    .select('association_code')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const allCodes = Array.from(new Set((data ?? []).map(r => (r.association_code as string).toUpperCase()))).sort()

  // The sweep is hourly and CINC is slow (and intermittently 502s), so the full
  // 26-association pass could exceed the 300s ceiling and die mid-way — losing
  // the whole run's work. Instead: start where the clock says (rotating by hour
  // so every association comes first sometimes) and stop cleanly at a time
  // budget. Whatever is left is picked up by the next hourly run.
  const BUDGET_MS = 240_000
  const startedAt = Date.now()
  const offset = allCodes.length ? (new Date().getUTCHours() * 5) % allCodes.length : 0
  const codes = [...allCodes.slice(offset), ...allCodes.slice(0, offset)]

  const results: ReconSyncStats[] = []
  const skipped: string[] = []
  for (const code of codes) {
    if (Date.now() - startedAt > BUDGET_MS) { skipped.push(code); continue }
    try {
      results.push(await syncReconciliationForAssoc(code))
    } catch (err) {
      results.push({
        associationCode:    code,
        bankAccountsTried:  0,
        transactionsSeen:   0,
        entriesCreated:     0,
        entriesUpdated:     0,
        draftMatches:       0,
        errors:             [{ message: (err as Error).message }],
      })
    }
  }

  // Summary for logs
  const totalCreated   = results.reduce((s, r) => s + r.entriesCreated,   0)
  const totalUpdated   = results.reduce((s, r) => s + r.entriesUpdated,   0)
  const totalMatches   = results.reduce((s, r) => s + r.draftMatches,     0)
  const totalTxs       = results.reduce((s, r) => s + r.transactionsSeen, 0)
  const totalErrors    = results.reduce((s, r) => s + r.errors.length,    0)
  console.log(`[recon-cron] swept ${results.length}/${allCodes.length} assocs in ${Math.round((Date.now() - startedAt) / 1000)}s: ${totalTxs} txs seen · ${totalCreated} created · ${totalUpdated} updated · ${totalMatches} draft matches · ${totalErrors} errors${skipped.length ? ` · ${skipped.length} deferred to the next run: ${skipped.join(', ')}` : ''}`)

  return NextResponse.json({
    ok:            true,
    assocsSwept:   results.length,
    assocsTotal:   allCodes.length,
    assocsDeferred: skipped,
    elapsedMs:     Date.now() - startedAt,
    totalCreated,
    totalUpdated,
    totalMatches,
    totalTxs,
    totalErrors,
    results,
  })
}
