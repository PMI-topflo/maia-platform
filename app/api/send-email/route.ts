import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/gmail'

export async function POST(req: NextRequest) {
  const { to, subject, body, html } = await req.json()

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    console.warn('[EMAIL] Gmail credentials not configured. Skipping send.', { to, subject })
    return NextResponse.json({ ok: true, skipped: true })
  }

  try {
    await sendEmail({ to, subject, html, text: body })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[EMAIL]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
