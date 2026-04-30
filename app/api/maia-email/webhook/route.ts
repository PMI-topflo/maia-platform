import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchGmailHistory } from '@/lib/gmail'
import { processEmailCommand } from '@/lib/maia-command-processor'

// POST /api/maia-email/webhook
// Receives Gmail push notifications via Google Cloud Pub/Sub.
//
// Setup (one-time in Google Cloud Console):
//   1. Create Pub/Sub topic: projects/<project>/topics/maia-inbox
//   2. Grant Gmail service account publisher role on that topic:
//      serviceAccount:gmail-api-push@system.gserviceaccount.com
//   3. Create a push subscription pointing to:
//      https://www.pmitop.com/api/maia-email/webhook?token=<GMAIL_PUBSUB_SECRET>
//      Ack deadline: 60s
//   4. POST /api/maia-email/setup-watch from the admin dashboard to register
//
// Required env vars: GMAIL_PUBSUB_SECRET

export async function POST(req: NextRequest) {
  // Verify shared secret in query param (set in Pub/Sub push endpoint URL)
  const secret = process.env.GMAIL_PUBSUB_SECRET
  if (secret) {
    const token = req.nextUrl.searchParams.get('token')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: { message?: { data?: string; messageId?: string }; subscription?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawData = body.message?.data
  if (!rawData) {
    // Acknowledge empty messages so Pub/Sub doesn't retry them
    return NextResponse.json({ ok: true })
  }

  let notification: { emailAddress?: string; historyId?: number }
  try {
    notification = JSON.parse(Buffer.from(rawData, 'base64').toString('utf-8'))
  } catch {
    console.error('[maia-webhook] Failed to decode Pub/Sub message')
    return NextResponse.json({ ok: true })  // ack to prevent infinite retry
  }

  const newHistoryId = String(notification.historyId ?? '')
  if (!newHistoryId) return NextResponse.json({ ok: true })

  // Read last processed historyId from DB
  const { data: state } = await supabaseAdmin
    .from('maia_watch_state')
    .select('last_history_id')
    .eq('id', 1)
    .maybeSingle()

  const lastHistoryId = state?.last_history_id

  // Update stored historyId immediately (before processing) to prevent re-processing on retry
  await supabaseAdmin
    .from('maia_watch_state')
    .upsert({ id: 1, last_history_id: newHistoryId, updated_at: new Date().toISOString() })

  if (!lastHistoryId) {
    // No baseline yet (first notification after setup-watch) — nothing to process
    return NextResponse.json({ ok: true })
  }

  // Get new message IDs since last historyId
  let messageIds: string[]
  try {
    messageIds = await fetchGmailHistory(lastHistoryId)
  } catch (err) {
    console.error('[maia-webhook] History API error:', err)
    return NextResponse.json({ ok: true })
  }

  // Process each new message (sequentially to avoid race conditions)
  for (const id of messageIds) {
    try {
      await processEmailCommand(id)
    } catch (err) {
      console.error(`[maia-webhook] processEmailCommand(${id}) error:`, err)
    }
  }

  return NextResponse.json({ ok: true, processed: messageIds.length })
}
