// =====================================================================
// lib/application-payment-link.ts
//
// Emails the primary applicant the /apply?listingApp=... payment link
// app/pre-apply/[code]/page.tsx's ScreeningPaymentGate already shows her —
// for the case that gate was never shown at all: an application already had
// her pass through her checklist page before the gate existed for her (or
// before this association defaulted to Checkr), so payment was never in her
// workflow.
//
// Extracted from app/api/admin/pre-apply/[id]/send-payment-link/route.ts
// (still its own staff-triggered button) so app/api/admin/pre-apply/[id]/
// request-screening/route.ts can reuse the exact same send instead of
// duplicating it. User direction, 2026-09-09: Checkr has no payment
// collection of its own, so a staff member clicking "Request background
// check via Checkr" on an application that hasn't actually paid must never
// silently do nothing — the safeguard is to send this same payment link
// automatically instead, rather than a dead-end error requiring a second
// manual click.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { logOutboundCommunication } from '@/lib/application-comm-log'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

export type SendPaymentLinkResult =
  | { ok: true; sentTo: string }
  | { ok: false; error: string; status: number }

export async function sendApplicationPaymentLink(id: string, loggedBy: string): Promise<SendPaymentLinkResult> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label, detailed_application_id').eq('id', id).maybeSingle()
  if (!app) return { ok: false, error: 'not found', status: 404 }
  if (app.detailed_application_id) return { ok: false, error: 'Payment is already on file for this application.', status: 400 }

  const { data: sh } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle()
  if (!sh) return { ok: false, error: 'No primary applicant on file for this application.', status: 404 }
  if (!sh.email) return { ok: false, error: `${sh.name ?? 'The applicant'} has no email on file — reach out directly instead.`, status: 400 }

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
    return { ok: false, error: `Could not send the link: ${(err as Error).message}`, status: 502 }
  }

  await logOutboundCommunication({
    applicationId: id, associationCode: code, unitLabel: unit || null,
    subject: 'Sent the confirm & pay link',
    body: `Asked ${sh.name ?? 'the applicant'} to confirm their application details and complete the background/credit check payment.`,
    toEmails: [sh.email as string],
    loggedBy,
  })

  return { ok: true, sentTo: sh.email as string }
}
