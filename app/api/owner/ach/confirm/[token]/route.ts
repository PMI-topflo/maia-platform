// =====================================================================
// GET /api/owner/ach/confirm/[token]
//
// Staff (Jonathan/Karen) click the "Confirm autopay set up" button in the
// enrollment email AFTER they've entered the ACH into CINC. This:
//   • emails the unit owner an automatic confirmation (with the "check next
//     month's payment was withdrawn" reminder), and
//   • marks the owner_ach_submissions row confirmed.
// Token scope owner_ach_confirm (signed when the staff email is built).
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyAchConfirmToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function page(title: string, body: string) {
  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#1a1a1a"><h1 style="color:#f26a1b">${title}</h1>${body}</div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyAchConfirmToken(token)
  if (!data) return page('⚠ Link expired', '<p>This confirmation link has expired or is invalid.</p>')

  // Owner info + email on file.
  const { data: o } = await supabaseAdmin.from('owners')
    .select('first_name, last_name, entity_name, unit_number, association_name, emails')
    .eq('association_code', data.assoc).eq('account_number', data.account).limit(1).maybeSingle()

  const ownerName = (o?.entity_name as string) || [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim() || 'Owner'
  const assoc     = (o?.association_name as string) || data.assoc
  const unit      = (o?.unit_number as string) || data.account
  const emails    = Array.isArray(o?.emails) ? (o!.emails as string[]) : String(o?.emails ?? '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
  const ownerEmail = emails[0] || null

  // Mark confirmed (best-effort).
  try {
    await supabaseAdmin.from('owner_ach_submissions')
      .update({ cinc_written: true, confirmed_at: new Date().toISOString() })
      .eq('association_code', data.assoc).eq('account_number', data.account)
  } catch { /* best-effort */ }

  if (!ownerEmail) {
    return page('✅ Marked confirmed', `<p>Autopay for <strong>Unit ${unit}</strong> at ${assoc} is marked set up, but we have <strong>no email on file</strong> for the owner — please reach out to them directly.</p>`)
  }

  await sendEmail({
    to: [ownerEmail],
    subject: `Your automatic payments are set up — Unit ${unit}, ${assoc}`,
    html: `<div style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:560px">
      <p>Hi ${ownerName.split(' ')[0]},</p>
      <p>✅ Good news — your <strong>automatic ACH payments</strong> are now set up for <strong>Unit ${unit}</strong> at ${assoc}. Your assessment will be drafted automatically on the <strong>1st of the month</strong>.</p>
      <div style="margin:18px 0;padding:14px 16px;background:#fff7ed;border:1px solid #fdba74;border-radius:10px">
        <p style="margin:0;font-size:17px;font-weight:800;color:#c2410c">⚠️ Please double-check next month</p>
        <p style="margin:6px 0 0;font-size:15px;color:#9a3412">Your <strong>first</strong> automatic payment may not start right away. Please <strong>confirm that next month's payment was actually withdrawn</strong> from your bank account. If it wasn't, contact us so you don't fall behind.</p>
      </div>
      <p style="color:#6b7280;font-size:13px">Questions? Accounts Receivable — ar@topfloridaproperties.com · (305) 900-5105</p>
      <p style="color:#9ca3af;font-size:12px">— MAIA, PMI Top Florida Properties</p>
    </div>`,
  }).catch(() => null)

  return page('✅ Owner notified', `<p>We emailed <strong>${ownerEmail}</strong> to confirm autopay is set up for <strong>Unit ${unit}</strong> at ${assoc}, including the reminder to check that next month's payment was withdrawn.</p><p style="color:#6b7280;font-size:13px">You can close this tab.</p>`)
}
