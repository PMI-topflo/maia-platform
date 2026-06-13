// =====================================================================
// POST /api/admin/vendor-compliance/request   (staff-only)
//
// action:'preview' { repTicketId, vendorName, needKeys[], missing[] }
//   → MAIA's templated draft (subject + body) for requesting the vendor's
//     missing compliance docs, including the deep-linked upload portal link
//     (?need=ach,w9). The staffer edits it before sending.
// action:'send' { repTicketId, to, subject, body }
//   → emails the (edited) message to the vendor and logs an internal note
//     on the work order.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { signVendorUploadToken } from '@/lib/vendor-upload-token'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

async function staff() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' ? session.userId : 'staff'
}

export async function POST(req: Request) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const action = String(body.action ?? '')
  const repTicketId = Number(body.repTicketId)
  if (!Number.isFinite(repTicketId)) return NextResponse.json({ error: 'repTicketId required' }, { status: 400 })

  if (action === 'preview') {
    const vendorName = String(body.vendorName ?? '').trim()
    const missing = Array.isArray(body.missing) ? body.missing.map(String) : []
    const needKeys = Array.isArray(body.needKeys) ? body.needKeys.map(String).filter(k => k === 'ach' || k === 'w9') : []
    if (missing.length === 0) return NextResponse.json({ error: 'Nothing is missing for this vendor.' }, { status: 400 })

    const uploadToken = await signVendorUploadToken(repTicketId)
    const qs = needKeys.length ? `?need=${needKeys.join(',')}` : ''
    const link = `${APP}/vendor/upload/${uploadToken}${qs}`

    const subject = `Documents needed — PMI Top Florida Properties`
    const bulleted = missing.map(m => `  • ${m}`).join('\n')
    const draft =
`Hello${vendorName ? ` ${vendorName}` : ''},

To keep your vendor file current and avoid any delay in payment, we still need the following from you:

${bulleted}

You can provide everything through this secure link — no account needed:
${link}

You can fill in your banking (ACH) and W-9 right in the form, or upload a PDF.

Thank you,
PMI Top Florida Properties`

    return NextResponse.json({ subject, body: draft, link })
  }

  if (action !== 'send') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const to = String(body.to ?? '').trim()
  const subject = String(body.subject ?? '').trim() || 'Documents needed — PMI Top Florida Properties'
  const text = String(body.body ?? '').trim()
  if (!to.includes('@')) return NextResponse.json({ error: 'A valid vendor email is required.' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'The message is empty.' }, { status: 400 })

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`
  try {
    await sendEmail({ to, subject, html, text })
  } catch (e) {
    return NextResponse.json({ error: `Couldn't send: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  await appendMessage(repTicketId, {
    direction: 'outbound', channel: 'email', from_addr: me, to_addr: to, subject,
    body: `📤 Sent ${to} a vendor-compliance document request.\n\n${text}`,
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
