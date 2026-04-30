import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { registerGmailWatch } from '@/lib/gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/maia-email/setup-watch
// Called once by an authenticated staff member to register the Gmail push watch.
// Gmail watches expire every 7 days — re-call this endpoint weekly to renew.
// Requires: GMAIL_PUBSUB_TOPIC env var = "projects/<project>/topics/<topic>"
export async function POST(req: NextRequest) {
  const token   = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const topic = process.env.GMAIL_PUBSUB_TOPIC
  if (!topic) {
    return NextResponse.json({ ok: false, error: 'GMAIL_PUBSUB_TOPIC env var not set' }, { status: 500 })
  }

  try {
    const watch = await registerGmailWatch(topic)

    // Store historyId and expiry in maia_watch_state (singleton row id=1)
    await supabaseAdmin
      .from('maia_watch_state')
      .upsert({
        id:              1,
        last_history_id: watch.historyId,
        watch_expiry:    new Date(Number(watch.expiration)).toISOString(),
        updated_at:      new Date().toISOString(),
      })

    return NextResponse.json({
      ok:        true,
      historyId: watch.historyId,
      expiry:    new Date(Number(watch.expiration)).toISOString(),
      message:   'Gmail watch registered. Re-call this endpoint weekly to renew (watches expire every 7 days).',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[setup-watch] Error:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
