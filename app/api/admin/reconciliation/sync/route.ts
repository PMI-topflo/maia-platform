// =====================================================================
// app/api/admin/reconciliation/sync/route.ts
//
// POST /api/admin/reconciliation/sync?assoc=LFA
//   Manual "Sync now" button on the reconciliation page. Pulls CINC
//   payments for every MAIA-pushed invoice in the assoc and upserts
//   rows into bank_reconciliation_entries.
//
// Also accepts `?cron=1&token=...` for the Vercel cron job (uses
// CRON_SECRET) — when called this way, iterates over EVERY association
// found in invoice_intake_drafts and syncs each.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { syncReconciliationForAssoc, type ReconSyncStats } from '@/lib/bank-reconciliation-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60  // hourly cron — pulls payments for up to ~25 assocs

export async function POST(req: Request) {
  const url     = new URL(req.url)
  const isCron  = url.searchParams.get('cron') === '1'
  const assoc   = url.searchParams.get('assoc')

  // Auth: staff session OR cron secret.
  if (isCron) {
    const token = url.searchParams.get('token') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (token !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 })
    }
  } else {
    const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value
    const session      = sessionToken ? await verifySession(sessionToken) : null
    if (!session || session.persona !== 'staff') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Decide which assocs to sync.
  let assocsToSync: string[] = []
  if (assoc) {
    assocsToSync = [assoc.toUpperCase()]
  } else {
    // Cron path — sweep every assoc that has at least one pushed-to-CINC draft.
    const { data, error } = await supabaseAdmin
      .from('invoice_intake_drafts')
      .select('extracted_association_code')
      .eq('status', 'pushed_to_cinc')
      .not('extracted_association_code', 'is', null)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    assocsToSync = Array.from(new Set((data ?? []).map(r => (r.extracted_association_code as string).toUpperCase())))
  }

  const results: ReconSyncStats[] = []
  for (const code of assocsToSync) {
    try {
      const stats = await syncReconciliationForAssoc(code)
      results.push(stats)
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

  return NextResponse.json({
    ok: true,
    assocsSynced: results.length,
    results,
  })
}
