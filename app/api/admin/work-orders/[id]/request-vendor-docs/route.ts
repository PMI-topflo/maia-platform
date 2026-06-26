// =====================================================================
// POST /api/admin/work-orders/[id]/request-vendor-docs   (staff-only)
//
// Emails the work order's vendor a secure link to provide the ACH / W-9
// they're missing in CINC, COPIES Paola (service@) so she can follow up,
// logs an internal note, and flags the WO "awaiting vendor docs". The flag
// clears automatically once the docs land (see vendor-compliance GET).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { appendMessage } from '@/lib/tickets'
import { signVendorUploadToken } from '@/lib/vendor-upload-token'
import { checkWoVendorCompliance } from '@/lib/wo-vendor-compliance'
import { VENDOR_NOTIFY_CC, VENDOR_REPLY_TO } from '@/lib/notify-recipients'
import { getAssociationName } from '@/lib/association-name'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const by = typeof session.userId === 'string' ? session.userId : 'staff'

  const id = parseInt((await ctx.params).id, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const c = await checkWoVendorCompliance(id)
  if (!c) return NextResponse.json({ error: 'work order not found' }, { status: 404 })
  if (c.missingKeys.length === 0) return NextResponse.json({ error: 'Nothing is missing for this vendor — ACH and W-9 are on file.' }, { status: 400 })
  const to = (c.vendor.vendorEmail ?? '').trim()
  if (!to.includes('@')) return NextResponse.json({ error: 'No vendor email on file for this work order — add one first.' }, { status: 400 })

  const assocName = await getAssociationName(c.vendor.associationCode)
  const forAssoc = assocName ? ` for ${assocName}` : ''
  const uploadToken = await signVendorUploadToken(id)
  const link = `${APP}/vendor/upload/${uploadToken}?need=${c.missingKeys.join(',')}`
  const bulleted = c.missing.map(m => `  • ${m}`).join('\n')
  const subject = `Documents needed before payment${assocName ? ` — ${assocName}` : ''}`
  const textBody =
`Hello${c.vendor.vendorName ? ` ${c.vendor.vendorName}` : ''},

Before we can process payment on your recent work${forAssoc}${c.vendor.ticketNumber ? ` (${c.vendor.ticketNumber})` : ''}, we still need the following on file:

${bulleted}

Please provide it through this secure link — no account needed:
${link}

You can enter your banking (ACH) and W-9 right in the form, or upload a PDF.

Thank you,
PMI Top Florida Properties`

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">${esc(textBody).replace(/\n/g, '<br>')}</div>`
  try {
    await sendEmail({ to, bcc: VENDOR_NOTIFY_CC, replyTo: VENDOR_REPLY_TO, subject, html, text: textBody })
  } catch (e) {
    return NextResponse.json({ error: `Couldn't send: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  // Flag the WO for follow-up + log the request.
  await supabaseAdmin.from('tickets')
    .update({ vendor_docs_requested_at: new Date().toISOString(), vendor_docs_needed: c.missingKeys.join(','), updated_at: new Date().toISOString() })
    .eq('id', id)
  await appendMessage(id, {
    direction: 'outbound', channel: 'email', from_addr: by, to_addr: to, subject,
    body: `📤 Requested ${c.missing.join(' + ')} from ${c.vendor.vendorName ?? 'the vendor'} (bcc ${VENDOR_NOTIFY_CC.join(', ')}). Work order flagged — follow up if not received.\n\n${textBody}`,
  }).catch(() => null)

  return NextResponse.json({ ok: true, requested: c.missingKeys, to, bcc: VENDOR_NOTIFY_CC })
}
