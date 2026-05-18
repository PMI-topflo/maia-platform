import { NextRequest, NextResponse } from 'next/server'
import { registerGmailWatch, registerGmailWatchWithToken, refreshStaffToken } from '@/lib/gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const topic = process.env.GMAIL_PUBSUB_TOPIC
  if (!topic) {
    return NextResponse.json({ ok: false, error: 'GMAIL_PUBSUB_TOPIC not set' }, { status: 500 })
  }

  const results: Record<string, string> = {}

  // Renew main account watch
  try {
    const watch = await registerGmailWatch(topic)
    await supabaseAdmin
      .from('maia_watch_state')
      .upsert({
        id:              1,
        last_history_id: watch.historyId,
        watch_expiry:    new Date(Number(watch.expiration)).toISOString(),
        updated_at:      new Date().toISOString(),
      })
    results['main'] = `renewed (${watch.historyId})`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] Main Gmail watch renewal failed:', msg)
    results['main'] = `failed: ${msg}`
  }

  // Renew staff account watches
  const { data: staffAccounts } = await supabaseAdmin
    .from('staff_gmail_accounts')
    .select('gmail_address, refresh_token, access_token, token_expiry')
    .eq('active', true)

  for (const account of (staffAccounts ?? [])) {
    const result = await renewStaffAccountWatch({
      gmail_address: account.gmail_address as string,
      refresh_token: account.refresh_token as string,
      access_token:  account.access_token as string | null,
      token_expiry:  account.token_expiry as string | null,
      topic,
    })
    results[account.gmail_address as string] = result.ok
      ? `renewed (${result.historyId})`
      : `failed: ${result.error}`
  }

  return NextResponse.json({ ok: true, results })
}

/** Single-account watch renewal with persistent success/error tracking.
 *  Exported so the on-demand /api/admin/gmail-accounts/[email]/renew-watch
 *  endpoint can reuse the same logic instead of duplicating the
 *  refresh-token-then-register dance. */
export async function renewStaffAccountWatch(opts: {
  gmail_address: string
  refresh_token: string
  access_token:  string | null
  token_expiry:  string | null
  topic:         string
}): Promise<
  | { ok: true;  historyId: string }
  | { ok: false; error: string; isInvalidGrant: boolean }
> {
  const now = new Date().toISOString()
  try {
    // Refresh the access token if expired or missing.
    const isExpired = !opts.token_expiry || new Date(opts.token_expiry).getTime() < Date.now() + 60_000
    let accessToken = opts.access_token ?? ''

    if (isExpired || !accessToken) {
      const refreshed = await refreshStaffToken(opts.refresh_token)
      accessToken = refreshed.access_token
      await supabaseAdmin
        .from('staff_gmail_accounts')
        .update({
          access_token: accessToken,
          token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at:   now,
        })
        .eq('gmail_address', opts.gmail_address)
    }

    const watch = await registerGmailWatchWithToken(opts.topic, accessToken)
    await supabaseAdmin
      .from('staff_gmail_accounts')
      .update({
        watch_expiry:           new Date(Number(watch.expiration)).toISOString(),
        last_watch_renewed_at:  now,
        last_watch_error:       null,
        last_watch_error_at:    null,
        updated_at:             now,
      })
      .eq('gmail_address', opts.gmail_address)

    return { ok: true, historyId: String(watch.historyId) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isInvalidGrant = /invalid_grant/i.test(msg)
    console.error(`[cron] Staff watch renewal failed for ${opts.gmail_address}:`, msg)
    await supabaseAdmin
      .from('staff_gmail_accounts')
      .update({
        last_watch_error:     msg.slice(0, 500),
        last_watch_error_at:  now,
        updated_at:           now,
      })
      .eq('gmail_address', opts.gmail_address)
    return { ok: false, error: msg, isInvalidGrant }
  }
}
