// =====================================================================
// app/api/cron/sync-reconciliation/route.ts
//
// Hourly Vercel cron. Sweeps every association that has at least one
// pushed-to-CINC invoice and syncs CINC payments → bank_reconciliation_
// entries. Idempotent.
//
// Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncReconciliationForAssoc, type ReconSyncStats } from '@/lib/bank-reconciliation-sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300  // sweep can take a few minutes if many assocs have many pushed invoices

export async function GET(req: Request) {
  // Vercel cron auth — token is sent in the Authorization header.
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('extracted_association_code')
    .eq('status', 'pushed_to_cinc')
    .not('extracted_association_code', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const codes = Array.from(new Set((data ?? []).map(r => (r.extracted_association_code as string).toUpperCase())))

  const results: ReconSyncStats[] = []
  for (const code of codes) {
    try {
      results.push(await syncReconciliationForAssoc(code))
    } catch (err) {
      results.push({
        associationCode:  code,
        invoicesChecked:  0,
        paymentsFetched:  0,
        entriesCreated:   0,
        entriesUpdated:   0,
        errors:           [{ invoiceId: 0, message: (err as Error).message }],
      })
    }
  }

  // Summary for logs
  const totalCreated = results.reduce((s, r) => s + r.entriesCreated, 0)
  const totalUpdated = results.reduce((s, r) => s + r.entriesUpdated, 0)
  const totalErrors  = results.reduce((s, r) => s + r.errors.length, 0)
  console.log(`[recon-cron] swept ${codes.length} assocs: ${totalCreated} created, ${totalUpdated} updated, ${totalErrors} errors`)

  return NextResponse.json({
    ok:           true,
    assocsSwept:  codes.length,
    totalCreated,
    totalUpdated,
    totalErrors,
    results,
  })
}
