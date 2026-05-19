import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyDialpadJwt, type DialpadCallEvent, type DialpadSmsEvent } from '@/lib/dialpad'
import { ingestCallEvent, ingestSmsEvent } from '@/lib/dialpad-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Dialpad pushes events here. The body is a single JWT (HS256) signed
// with the secret we supplied at /webhooks creation. We log + return
// 200 even on partial failure so Dialpad doesn't get stuck retrying
// the same broken payload forever — application-level errors are
// surfaced in server logs, not via HTTP status.
export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!raw) return NextResponse.json({ ok: true })

  let secret: string | null = null
  try {
    const { data } = await supabaseAdmin
      .from('dialpad_webhook_config')
      .select('webhook_id, webhook_secret')
      .eq('id', 1)
      .maybeSingle()
    if (!data?.webhook_id) {
      return NextResponse.json({ ok: false, error: 'dialpad webhook not configured' }, { status: 503 })
    }
    secret = (data.webhook_secret as string | null) ?? null
  } catch (err) {
    console.error('[dialpad webhook] config lookup failed:', err)
    return NextResponse.json({ ok: false, error: 'config lookup failed' }, { status: 503 })
  }

  let payload: Record<string, unknown> | null = null
  const trimmed = raw.trim()
  if (trimmed.startsWith('ey') && trimmed.split('.').length === 3) {
    if (!secret) {
      console.error('[dialpad webhook] JWT received but no secret stored — rejecting')
      return NextResponse.json({ ok: false, error: 'no secret on file' }, { status: 401 })
    }
    const { valid, payload: decoded } = verifyDialpadJwt(trimmed, secret)
    if (!valid || !decoded) {
      console.error('[dialpad webhook] invalid JWT signature')
      return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 })
    }
    payload = decoded
  } else {
    try {
      payload = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      console.error('[dialpad webhook] body is neither JWT nor JSON')
      return NextResponse.json({ ok: true })
    }
  }

  try {
    if (isCallEvent(payload)) {
      await ingestCallEvent(payload as unknown as DialpadCallEvent)
    } else if (isSmsEvent(payload)) {
      await ingestSmsEvent(payload as unknown as DialpadSmsEvent)
    } else {
      console.warn('[dialpad webhook] unrecognized payload shape; keys =', Object.keys(payload ?? {}))
    }
  } catch (err) {
    // Swallow + log: returning 5xx triggers Dialpad's retry storm.
    console.error('[dialpad webhook] ingest error:', err)
  }

  return NextResponse.json({ ok: true })
}

function isCallEvent(p: Record<string, unknown> | null): boolean {
  if (!p) return false
  return 'call_id' in p && 'state' in p
}

function isSmsEvent(p: Record<string, unknown> | null): boolean {
  if (!p) return false
  // SMS payload has `text` OR (`from_number` AND no `state` key)
  if ('text' in p) return true
  if ('from_number' in p && !('state' in p)) return true
  return false
}
