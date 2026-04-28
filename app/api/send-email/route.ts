import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/gmail'
import { logEmail } from '@/lib/email-logger'

export async function POST(req: NextRequest) {
  const { to, subject, body, html, persona, associationCode } = await req.json()

  if (!process.env.RESEND_API_KEY && (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN)) {
    console.warn('[EMAIL] No email provider configured. Skipping send.', { to, subject })
    return NextResponse.json({ ok: true, skipped: true })
  }

  try {
    const { messageId } = await sendEmail({ to, subject, html, text: body })
    void logEmail({
      toEmail:         Array.isArray(to) ? to[0] : to,
      subject,
      fullBody:        html ?? body,
      persona,
      associationCode,
      resendMessageId: messageId,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[EMAIL]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
