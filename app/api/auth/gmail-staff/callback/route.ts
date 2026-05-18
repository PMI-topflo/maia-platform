import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { registerGmailWatchWithToken } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const code        = req.nextUrl.searchParams.get('code')
  const connectedBy = req.nextUrl.searchParams.get('state') ?? 'unknown'
  const errorParam  = req.nextUrl.searchParams.get('error')
  const appUrl      = process.env.NEXT_PUBLIC_APP_URL!

  if (errorParam || !code) {
    return NextResponse.redirect(`${appUrl}/admin/tools?gmail_error=${errorParam ?? 'no_code'}`)
  }

  try {
    const redirectUri = `${appUrl}/api/auth/gmail-staff/callback`

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('[gmail-staff/callback] Token exchange failed:', err)
      return NextResponse.redirect(`${appUrl}/admin/tools?gmail_error=token_failed`)
    }

    const tokens = await tokenRes.json() as {
      access_token:  string
      refresh_token?: string
      expires_in:    number
      token_type:    string
    }

    if (!tokens.refresh_token) {
      // This happens if the user previously connected and revoked offline access
      return NextResponse.redirect(`${appUrl}/admin/tools?gmail_error=no_refresh_token`)
    }

    // Get the Gmail address and display name via userinfo
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const user = await userRes.json() as { email: string; name?: string }

    // Guard against the cross-account mistake: if the caller passed a
    // specific email via the connected_by state ("reconnect this exact
    // account") and the user authorized a DIFFERENT Google account, do
    // not silently overwrite either account. Send them back with an
    // error explaining what happened.
    if (
      connectedBy
      && connectedBy.includes('@')
      && connectedBy.toLowerCase() !== user.email.toLowerCase()
    ) {
      console.warn(
        `[gmail-staff/callback] account mismatch: state=${connectedBy} but authorized as ${user.email}`,
      )
      return NextResponse.redirect(
        `${appUrl}/admin/tools?gmail_error=${encodeURIComponent(
          `Expected ${connectedBy} but you signed in as ${user.email}. Use an incognito window and pick the right account.`,
        )}`,
      )
    }

    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Save (or update) to staff_gmail_accounts.
    // Re-connection also clears the stale diagnostic fields so the
    // /admin/tools row immediately drops the NEEDS RECONNECT badge.
    const nowIso = new Date().toISOString()
    const { error: upsertErr } = await supabaseAdmin
      .from('staff_gmail_accounts')
      .upsert({
        gmail_address:        user.email,
        display_name:         user.name ?? null,
        refresh_token:        tokens.refresh_token,
        access_token:         tokens.access_token,
        token_expiry:         tokenExpiry,
        connected_by:         connectedBy,
        active:               true,
        last_watch_error:     null,
        last_watch_error_at:  null,
        updated_at:           nowIso,
      }, { onConflict: 'gmail_address' })

    if (upsertErr) {
      console.error('[gmail-staff/callback] DB upsert failed:', upsertErr.message)
      return NextResponse.redirect(`${appUrl}/admin/tools?gmail_error=db_failed`)
    }

    // Register Gmail watch so Pub/Sub notifies us of new messages
    const topic = process.env.GMAIL_PUBSUB_TOPIC
    if (topic) {
      try {
        const watch = await registerGmailWatchWithToken(topic, tokens.access_token)
        await supabaseAdmin
          .from('staff_gmail_accounts')
          .update({
            history_id:             watch.historyId,
            watch_expiry:           new Date(Number(watch.expiration)).toISOString(),
            last_watch_renewed_at:  nowIso,
            updated_at:             nowIso,
          })
          .eq('gmail_address', user.email)
      } catch (watchErr) {
        // Watch setup failure is non-fatal — emails still appear if watch is set up manually
        const msg = watchErr instanceof Error ? watchErr.message : String(watchErr)
        console.error('[gmail-staff/callback] Watch setup failed:', msg)
        // Re-stamp the error so the UI surfaces it instead of silently
        // showing green when the watch wasn't actually registered.
        await supabaseAdmin
          .from('staff_gmail_accounts')
          .update({
            last_watch_error:     msg.slice(0, 500),
            last_watch_error_at:  nowIso,
          })
          .eq('gmail_address', user.email)
      }
    }

    const displayEmail = encodeURIComponent(user.email)
    return NextResponse.redirect(`${appUrl}/admin/tools?gmail_connected=${displayEmail}`)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gmail-staff/callback] Unexpected error:', msg)
    return NextResponse.redirect(`${appUrl}/admin/tools?gmail_error=unexpected`)
  }
}
