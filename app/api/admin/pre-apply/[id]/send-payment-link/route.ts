// POST /api/admin/pre-apply/[id]/send-payment-link
//
// Emails the primary applicant the same /apply?listingApp=... payment link
// app/pre-apply/[code]/page.tsx's ScreeningPaymentGate already shows her --
// for the case that gate was never shown at all: an application that
// started on Tenant Evaluation and only later got switched to Checkr (see
// switch-to-checkr/route.ts) already had her pass through her checklist
// page before the gate existed for her, so payment was never in her
// workflow. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { logOutboundCommunication } from '@/lib/application-comm-log'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label, detailed_application_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (app.detailed_application_id) return NextResponse.json({ error: 'Payment is already on file for this application.' }, { status: 400 })

  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
  if (!sh) return NextResponse.json({ error: 'No primary applicant on file for this application.' }, { status: 404 })
  if (!sh.email) return NextResponse.json({ error: `${sh.name ?? 'The applicant'} has no email on file — reach out directly instead.` }, { status: 400 })

  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? ''
  const link = `${APP}/apply?listingApp=${encodeURIComponent(id)}&assoc=${encodeURIComponent(code)}&unit=${encodeURIComponent(unit)}&lang=en`

  try {
    await sendEmail({
      to: sh.email as string,
      subject: `Action needed — confirm your application & pay for your background check${unit ? ` (Unit ${unit})` : ''}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
        <p>Hi${sh.name ? ` ${esc(String(sh.name))}` : ''},</p>
        <p>To continue your application${unit ? ` for Unit ${esc(unit)}` : ''}, please confirm your details and complete the one-time background/credit check fee.</p>
        <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Confirm & pay →</a></p>
        <p style="color:#9ca3af;font-size:12px">If the button doesn't work, copy this link:<br>${link}</p>
      </div>`,
    })
  } catch (err) {
    return NextResponse.json({ error: `Could not send the link: ${(err as Error).message}` }, { status: 502 })
  }

  await logOutboundCommunication({
    applicationId: id, associationCode: code, unitLabel: unit || null,
    subject: 'Sent the confirm & pay link',
    body: `Asked ${sh.name ?? 'the applicant'} to confirm their application details and complete the background/credit check payment.`,
    toEmails: [sh.email as string],
    loggedBy: `staff:${session.displayName}`,
  })

  return NextResponse.json({ ok: true, sentTo: sh.email })
}
