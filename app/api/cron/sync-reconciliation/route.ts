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

  const codes = Array.from(new Set((data ?? []).map(r => (r.association_code as string).toUpperCase())))

  const results: ReconSyncStats[] = []
  for (const code of codes) {
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
  console.log(`[recon-cron] swept ${codes.length} assocs: ${totalTxs} txs seen · ${totalCreated} created · ${totalUpdated} updated · ${totalMatches} draft matches · ${totalErrors} errors`)

  return NextResponse.json({
    ok:            true,
    assocsSwept:   codes.length,
    totalCreated,
    totalUpdated,
    totalMatches,
    totalTxs,
    totalErrors,
    results,
  })
}
