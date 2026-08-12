// POST /api/webhooks/resend
// Resend delivery events (Svix-signed). Records what actually happened to each
// MAIA email — delivered / bounced / complained / opened — against the send we
// logged, so staff can see "did the board member actually receive it?" inside
// MAIA instead of opening the Resend dashboard.
//
// Setup: Resend → Webhooks → add this URL, copy the signing secret into
// RESEND_WEBHOOK_SECRET. Unsigned/invalid requests are rejected.

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Resend event → the status we store. Ordered by severity so a later "opened"
// never overwrites a "bounced".
const RANK: Record<string, number> = { sent: 1, delivered: 2, delivery_delayed: 3, opened: 4, clicked: 5, complained: 8, bounced: 9, failed: 9 }
const STATUS_OF: Record<string, string> = {
  'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delivery_delayed',
  'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced',
  'email.complained': 'complained', 'email.failed': 'failed',
}

/** Svix signature check: HMAC-SHA256 over `${id}.${timestamp}.${body}`. */
function verify(secret: string, id: string, ts: string, body: string, header: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  // Header is a space-separated list of `v1,<signature>`.
  for (const part of header.split(' ')) {
    const sig = part.split(',')[1]
    if (!sig) continue
    const a = Buffer.from(sig), b = Buffer.from(expected)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true
  }
  return false
}

export async function POST(req: Request) {
  const raw = await req.text()
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const id = req.headers.get('svix-id') ?? ''
  const ts = req.headers.get('svix-timestamp') ?? ''
  const sigHeader = req.headers.get('svix-signature') ?? ''

  if (!secret) return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET not set' }, { status: 500 })
  if (!id || !ts || !sigHeader) return NextResponse.json({ error: 'missing signature headers' }, { status: 401 })
  // Reject replays older than 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return NextResponse.json({ error: 'stale timestamp' }, { status: 401 })
  if (!verify(secret, id, ts, raw, sigHeader)) return NextResponse.json({ error: 'bad signature' }, { status: 401 })

  let evt: { type?: string; data?: { email_id?: string; to?: string[] | string; subject?: string } }
  try { evt = JSON.parse(raw) } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const status = STATUS_OF[String(evt.type ?? '')]
  const emailId = String(evt.data?.email_id ?? '')
  if (!status || !emailId) return NextResponse.json({ ok: true, ignored: evt.type ?? null })

  // Only move the status forward (bounced must not be overwritten by a later open).
  const { data: rows } = await supabaseAdmin.from('outbound_send_attempts')
    .select('id, delivery_status').eq('provider_message_id', emailId)
  for (const r of rows ?? []) {
    const cur = (r.delivery_status as string | null) ?? null
    if (cur && (RANK[cur] ?? 0) >= (RANK[status] ?? 0)) continue
    await supabaseAdmin.from('outbound_send_attempts').update({ delivery_status: status }).eq('id', r.id)
  }

  return NextResponse.json({ ok: true, status, matched: (rows ?? []).length })
}
