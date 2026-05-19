import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data: cfg, error: cfgErr } = await supabaseAdmin
      .from('dialpad_webhook_config')
      .select('webhook_id, webhook_url, sms_subscription_id, call_subscription_id, updated_at')
      .eq('id', 1)
      .maybeSingle()
    if (cfgErr) {
      return NextResponse.json({ ok: false, missingMigration: true, error: cfgErr.message })
    }

    const { count: linesCount } = await supabaseAdmin
      .from('staff_dialpad_lines')
      .select('id', { count: 'exact', head: true })
    const { count: numbersCount } = await supabaseAdmin
      .from('dialpad_numbers')
      .select('id', { count: 'exact', head: true })

    return NextResponse.json({
      ok:               true,
      connected:        !!cfg?.webhook_id,
      hookUrl:          cfg?.webhook_url ?? null,
      smsSubscriptionId:  cfg?.sms_subscription_id  ?? null,
      callSubscriptionId: cfg?.call_subscription_id ?? null,
      updatedAt:        cfg?.updated_at ?? null,
      staffLinesCount:  linesCount  ?? 0,
      numbersCount:     numbersCount ?? 0,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
