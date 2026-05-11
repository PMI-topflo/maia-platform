// =====================================================================
// app/api/cron/sync-cinc-inbound/route.ts
// Phase B-1 / B-2 — pull new CINC work orders and updates on existing
// ones into our tickets / ticket_messages. Runs every 5 min via
// vercel.json. Auth via CRON_SECRET (matches the existing cron pattern).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { syncCincInbound }           from '@/lib/integrations/cinc-inbound'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (process.env.CINC_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'CINC_SYNC_ENABLED!=true' })
  }

  try {
    const result = await syncCincInbound()
    if (result.errors.length > 0) {
      console.error('[sync-cinc-inbound] partial errors:', result.errors)
    } else if (result.ticketsInserted > 0 || result.notesInserted > 0 || result.ticketsUpdated > 0) {
      console.log(`[sync-cinc-inbound] +${result.ticketsInserted} tickets, ${result.ticketsUpdated} updated, +${result.notesInserted} notes (discovery=${result.discoveryCount}, refresh=${result.refreshCount})`)
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sync-cinc-inbound] fatal:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
