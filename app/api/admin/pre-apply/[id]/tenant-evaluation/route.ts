// GET  /api/admin/pre-apply/[id]/tenant-evaluation → recipients, blockers, guide config
// POST /api/admin/pre-apply/[id]/tenant-evaluation → email every applicant with an
//   address on file the association's Tenant Evaluation guide (property code,
//   QR code, direct link) attached, so they can start the background-check
//   application themselves. This is NOT the same document as `background_credit`
//   on the checklist — that's the RESULT (staff pulls it from Tenant Evaluation
//   and uploads it separately); this is the nudge that gets an applicant who
//   hasn't started onto the platform at all. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendEmail } from '@/lib/gmail'
import { logOutboundCommunication } from '@/lib/application-comm-log'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { TENANT_EVALUATION_GUIDES } from '@/lib/tenant-evaluation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

async function loadContext(id: string) {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('id, name, email').eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  return { code, unit: (app.unit_label as string | null) ?? null, legal, applicants: (sh ?? []) as { id: string; name: string | null; email: string | null }[] }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const guide = TENANT_EVALUATION_GUIDES[c.code] ?? null
  const withEmail = c.applicants.filter(a => a.email)
  const blockers: string[] = []
  if (!guide) blockers.push(`No Tenant Evaluation guide configured for ${c.code} yet.`)
  if (c.applicants.length === 0) blockers.push('Nobody is on the applicant roster yet.')
  else if (withEmail.length === 0) blockers.push('None of the applicants have an email on file yet.')

  return NextResponse.json({
    recipients: withEmail.map(a => ({ name: a.name, email: a.email })),
    skipped: c.applicants.filter(a => !a.email).map(a => a.name ?? 'unnamed applicant'),
    propertyCode: guide?.propertyCode ?? null,
    blockers,
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const guide = TENANT_EVALUATION_GUIDES[c.code]
  if (!guide) return NextResponse.json({ error: `No Tenant Evaluation guide configured for ${c.code} yet.` }, { status: 400 })
  const recipients = c.applicants.filter(a => a.email) as { id: string; name: string | null; email: string }[]
  if (!recipients.length) return NextResponse.json({ error: 'No applicant has an email on file — add one first.' }, { status: 400 })

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(guide.storagePath)
  if (dlErr || !blob) return NextResponse.json({ error: `Could not read the guide: ${dlErr?.message ?? 'not found'}` }, { status: 500 })
  const guideB64 = Buffer.from(await blob.arrayBuffer()).toString('base64')

  const unitLabel = c.unit ?? '—'
  const sent: string[] = []
  const failed: string[] = []
  for (const r of recipients) {
    try {
      await sendEmail({
        to: r.email,
        subject: `Start your background check — Unit ${unitLabel}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
          <p>Hello${r.name ? ` ${esc(r.name)}` : ''},</p>
          <p>${esc(c.legal)} uses <strong>Tenant Evaluation</strong> for the background/credit check that's part of your application for Unit ${esc(unitLabel)}. The attached guide walks through creating an account and starting your application — it takes about 45 minutes.</p>
          <p><strong>Property code:</strong> ${esc(guide.propertyCode)}</p>
          <p>Or go directly to <a href="${esc(guide.applyUrl)}">${esc(guide.applyUrl)}</a> and search for the community by name.</p>
          <p style="color:#9ca3af;font-size:12px">There is a fee for this application, charged by Tenant Evaluation when you submit — not by ${esc(c.legal)} or PMI. Tenant Evaluation does not decide your approval; the association's Board makes that decision after reviewing your full application.</p>
          <p>Thank you,<br>${esc(c.legal)}</p>
        </div>`,
        attachments: [{ filename: 'Tenant Evaluation Guide.pdf', content: guideB64 }],
      })
      sent.push(r.email)
    } catch { failed.push(r.email) }
  }

  if (sent.length) {
    await logOutboundCommunication({
      applicationId: id, associationCode: c.code, unitLabel: c.unit,
      subject: `Start your background check — Unit ${unitLabel}`,
      body: `Sent the Tenant Evaluation guide (property code ${guide.propertyCode}) to: ${sent.join(', ')}.`,
      toEmails: sent, loggedBy: `staff:${session.displayName}`,
    })
  }

  return NextResponse.json({ ok: sent.length > 0, sent, failed })
}
