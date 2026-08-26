// =====================================================================
// lib/application-guide-request.ts
//
// "@maia guide" / "@maia application guide" / "@maia requirements" —
// anyone emailing maia@pmitop.com (staff, an agent, an applicant — this one
// is NOT staff-only, unlike most @maia commands) asking for the Application
// Guide gets it back as a PDF attachment. Same shape as the upapp trigger in
// lib/application-comm-log.ts: a dedicated regex, an early return, a reply
// that says exactly what happened.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { buildApplicationGuideData, guideAvailable } from '@/lib/application-guide-data'
import { ApplicationGuidePdf } from '@/lib/application-guide-pdf'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

// "@maia guide", "@maia application guide", "@maia requirements" — an
// optional association code can follow ("@maia guide MANXI").
const TRIGGER_RE = /@maia\s+(?:application\s+)?(?:guide|requirements?)\b\s*([A-Za-z]{3,10})?/i

export interface GuideRequest { associationCode: string | null }

export function detectApplicationGuideTrigger(body: string): GuideRequest | null {
  const m = TRIGGER_RE.exec(body.replace(/\s+/g, ' '))
  if (!m) return null
  return { associationCode: m[1] ? m[1].toUpperCase() : null }
}

/** The sender's own association, when it can be determined without asking —
 *  an owner, tenant, or board member with exactly one distinct association
 *  on file for that email. Anyone else (or an ambiguous multi-association
 *  match) gets null, and the reply asks which association instead of
 *  guessing wrong. */
async function resolveSenderAssociation(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase()
  if (!e) return null
  const [{ data: owners }, { data: tenants }, { data: board }] = await Promise.all([
    supabaseAdmin.from('owners').select('association_code, emails').ilike('emails', `%${e}%`),
    supabaseAdmin.from('unit_tenant_contacts').select('association_code, tenant_email').eq('tenant_email', e),
    supabaseAdmin.from('association_board_members').select('association_code, email').eq('email', e),
  ])
  const codes = new Set<string>([
    ...(owners ?? []).filter(o => String(o.emails ?? '').toLowerCase().split(',').map(x => x.trim()).includes(e)).map(o => String(o.association_code)),
    ...(tenants ?? []).map(t => String(t.association_code)),
    ...(board ?? []).map(b => String(b.association_code)),
  ])
  return codes.size === 1 ? [...codes][0] : null
}

/** Handle a detected guide request end-to-end: resolve the association,
 *  build + attach the PDF (or explain why not), and send the reply. Never
 *  throws — a failure just means a plainer reply. */
export async function replyWithApplicationGuide(opts: {
  req: GuideRequest; senderEmail: string; senderName: string | null; subject: string; rfcMessageId?: string | null
}): Promise<void> {
  const assoc = opts.req.associationCode ?? await resolveSenderAssociation(opts.senderEmail)
  const subject = opts.subject.startsWith('Re:') ? opts.subject : `Re: ${opts.subject}`
  const headers = opts.rfcMessageId ? { 'In-Reply-To': opts.rfcMessageId, References: opts.rfcMessageId } : undefined
  const greeting = opts.senderName ? `Hi ${opts.senderName},` : 'Hi,'

  if (!assoc) {
    await sendEmail({
      to: opts.senderEmail, subject, headers,
      html: `<p>${greeting}</p><p>Happy to send that — which association is this for? Reply with the name or code (e.g. "MANXI guide") and I'll send the requirements right over.</p><p style="color:#9ca3af;font-size:12px">PMI Top Florida Properties</p>`,
    }).catch(() => null)
    return
  }

  if (!guideAvailable(assoc)) {
    await sendEmail({
      to: opts.senderEmail, subject, headers,
      html: `<p>${greeting}</p><p>A downloadable Application Guide isn't ready for ${assoc} yet — please contact the office and we'll get you the requirements directly.</p><p style="color:#9ca3af;font-size:12px">PMI Top Florida Properties</p>`,
    }).catch(() => null)
    return
  }

  try {
    const data = await buildApplicationGuideData(assoc)
    if (!data) throw new Error('guide data unavailable')
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const pdf = await renderToBuffer(ApplicationGuidePdf({ data }))
    await sendEmail({
      to: opts.senderEmail, subject, headers,
      attachments: [{ filename: `${assoc} Application Guide.pdf`, content: pdf.toString('base64') }],
      html: `<p>${greeting}</p><p>Attached is the ${assoc} Application Guide — eligibility rules, the application process and fees, and the full document checklist. It's also always available at <a href="${APP}/apply/${assoc}/guide">${APP}/apply/${assoc}/guide</a>.</p><p style="color:#9ca3af;font-size:12px">PMI Top Florida Properties</p>`,
    })
  } catch (err) {
    console.error('[application-guide-request] failed to build/send:', err instanceof Error ? err.message : err)
    await sendEmail({
      to: opts.senderEmail, subject, headers,
      html: `<p>${greeting}</p><p>I ran into a problem generating that just now — you can get it directly at <a href="${APP}/apply/${assoc}/guide">${APP}/apply/${assoc}/guide</a>, or reply and we'll send it another way.</p><p style="color:#9ca3af;font-size:12px">PMI Top Florida Properties</p>`,
    }).catch(() => null)
  }
}
