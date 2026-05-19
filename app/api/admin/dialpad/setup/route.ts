import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createCallSubscription, createSmsSubscription, createWebhook } from '@/lib/dialpad'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CALL_STATES = [
  'hangup',
  'missed',
  'voicemail',
  'voicemail_uploaded',
  'recording',
  'transcription',
  'recap_summary',
]

export async function POST() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('dialpad_webhook_config')
    .select('id, webhook_id')
    .eq('id', 1)
    .maybeSingle()
  if (existingErr) {
    return NextResponse.json({ ok: false, error: `config table missing: ${existingErr.message}` }, { status: 500 })
  }
  if (existing?.webhook_id) {
    return NextResponse.json({ ok: false, error: 'Dialpad webhook already configured' }, { status: 409 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 500 })
  }
  const hookUrl = `${appUrl.replace(/\/$/, '')}/api/dialpad/webhook`
  const secret  = crypto.randomBytes(32).toString('hex')

  try {
    const webhook = await createWebhook(hookUrl, secret)
    const smsSub  = await createSmsSubscription({ endpointId: webhook.id, direction: 'all', includeInternal: false })
    const callSub = await createCallSubscription({ endpointId: webhook.id, callStates: CALL_STATES })

    const { error: upsertErr } = await supabaseAdmin
      .from('dialpad_webhook_config')
      .upsert({
        id:                   1,
        webhook_id:           webhook.id,
        webhook_url:          hookUrl,
        webhook_secret:       secret,
        sms_subscription_id:  smsSub.id,
        call_subscription_id: callSub.id,
        updated_at:           new Date().toISOString(),
      }, { onConflict: 'id' })
    if (upsertErr) {
      return NextResponse.json({ ok: false, error: `db upsert failed: ${upsertErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      ok:                 true,
      webhookId:          webhook.id,
      smsSubscriptionId:  smsSub.id,
      callSubscriptionId: callSub.id,
      hookUrl,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
