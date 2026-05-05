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
    try {
      // Get a valid access token
      const isExpired = !account.token_expiry || new Date(account.token_expiry).getTime() < Date.now() + 60_000
      let accessToken = account.access_token as string

      if (isExpired || !accessToken) {
        const refreshed = await refreshStaffToken(account.refresh_token as string)
        accessToken = refreshed.access_token
        await supabaseAdmin
          .from('staff_gmail_accounts')
          .update({
            access_token: accessToken,
            token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            updated_at:   new Date().toISOString(),
          })
          .eq('gmail_address', account.gmail_address)
      }

      const watch = await registerGmailWatchWithToken(topic, accessToken)
      await supabaseAdmin
        .from('staff_gmail_accounts')
        .update({
          watch_expiry: new Date(Number(watch.expiration)).toISOString(),
          updated_at:   new Date().toISOString(),
        })
        .eq('gmail_address', account.gmail_address)

      results[account.gmail_address as string] = `renewed (${watch.historyId})`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron] Staff watch renewal failed for ${account.gmail_address}:`, msg)
      results[account.gmail_address as string] = `failed: ${msg}`
    }
  }

  return NextResponse.json({ ok: true, results })
}
