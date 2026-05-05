import { NextRequest, NextResponse } from 'next/server'

// GET /api/auth/gmail-staff/authorize?connected_by=<staff_email>
// Redirects to Google OAuth to connect a staff Gmail account.
// The redirect URI must be registered in Google Cloud Console:
//   https://<your-domain>/api/auth/gmail-staff/callback
export async function GET(req: NextRequest) {
  const clientId = process.env.GMAIL_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GMAIL_CLIENT_ID not configured' }, { status: 500 })

  const connectedBy  = req.nextUrl.searchParams.get('connected_by') ?? 'unknown'
  const redirectUri  = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail-staff/callback`

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id',     clientId)
  url.searchParams.set('redirect_uri',  redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope',         'https://www.googleapis.com/auth/gmail.readonly email profile')
  url.searchParams.set('access_type',   'offline')
  url.searchParams.set('prompt',        'consent')      // forces refresh_token to be issued
  url.searchParams.set('state',         connectedBy)

  return NextResponse.redirect(url.toString())
}
