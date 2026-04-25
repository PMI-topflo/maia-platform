import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { sessionId, messages, persona, language, associationCode } = await req.json()

  if (sessionId) {
    void supabaseAdmin
      .from('general_conversations')
      .update({ feedback: 'negative' })
      .eq('session_id', sessionId)
  }

  const base = process.env.NEXT_PUBLIC_APP_URL
  const convoHtml = (messages ?? [])
    .map((m: { role: string; content: string }) =>
      `<tr style="vertical-align:top"><td style="padding:6px 10px;background:${m.role === 'user' ? '#fff3e8' : '#f5f5f5'};font-weight:600;width:70px;white-space:nowrap">${m.role === 'user' ? 'User' : 'MAIA'}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${m.content.replace(/\n/g, '<br/>')}</td></tr>`
    )
    .join('')

  const html = `
    <h2 style="font-family:Arial,sans-serif;color:#111">MAIA Chat — Negative Feedback</h2>
    <table style="font-family:Arial,sans-serif;font-size:13px;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="padding:6px 10px;background:#f5f5f5;font-weight:600;width:120px">Persona</td><td style="padding:6px 10px">${persona ?? '—'}</td></tr>
      <tr><td style="padding:6px 10px;background:#f5f5f5;font-weight:600">Language</td><td style="padding:6px 10px">${language ?? '—'}</td></tr>
      <tr><td style="padding:6px 10px;background:#f5f5f5;font-weight:600">Association</td><td style="padding:6px 10px">${associationCode ?? '—'}</td></tr>
      <tr><td style="padding:6px 10px;background:#f5f5f5;font-weight:600">Session</td><td style="padding:6px 10px;font-size:11px;color:#888">${sessionId ?? '—'}</td></tr>
    </table>
    <h3 style="font-family:Arial,sans-serif;font-size:14px;color:#f97316">Conversation</h3>
    <table style="font-family:Arial,sans-serif;font-size:13px;border-collapse:collapse;width:100%;max-width:600px">
      ${convoHtml}
    </table>
    <p style="font-family:Arial,sans-serif;font-size:11px;color:#888;margin-top:16px">Sent automatically when a user clicked 👎 in the MAIA widget.</p>
  `

  await fetch(`${base}/api/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: 'maia@pmitop.com',
      subject: `[MAIA Feedback] 👎 Negative — ${persona ?? 'unknown'} ${associationCode ? `(${associationCode})` : ''}`,
      html,
    }),
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
