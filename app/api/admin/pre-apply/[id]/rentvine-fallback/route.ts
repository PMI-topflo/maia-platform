// GET  /api/admin/pre-apply/[id]/rentvine-fallback → recipients, blockers
// POST /api/admin/pre-apply/[id]/rentvine-fallback → emails every applicant
//   with an email on file a link to PMI's Rentvine-hosted application, as an
//   alternative background-check path if Checkr has an issue. One fixed,
//   generic link — Rentvine's own apply form isn't scoped to a unit or
//   address for this purpose (user direction, 2026-09-03), so unlike Tenant
//   Evaluation this needs no per-association guide/property-code lookup.
//   Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendEmail } from '@/lib/gmail'
import { logOutboundCommunication } from '@/lib/application-comm-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

const RENTVINE_APPLY_URL = 'https://pmitopfloridaproperties.rentvine.com/public/apply?unitID=38'

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

  const withEmail = c.applicants.filter(a => a.email)
  const blockers: string[] = []
  if (c.applicants.length === 0) blockers.push('Nobody is on the applicant roster yet.')
  else if (withEmail.length === 0) blockers.push('None of the applicants have an email on file yet.')

  return NextResponse.json({
    url: RENTVINE_APPLY_URL,
    recipients: withEmail.map(a => ({ name: a.name, email: a.email })),
    skipped: c.applicants.filter(a => !a.email).map(a => a.name ?? 'unnamed applicant'),
    blockers,
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await loadContext(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const recipients = c.applicants.filter(a => a.email) as { id: string; name: string | null; email: string }[]
  if (!recipients.length) return NextResponse.json({ error: 'No applicant has an email on file — add one first.' }, { status: 400 })

  const unitLabel = c.unit ?? '—'
  const sent: string[] = []
  const failed: string[] = []
  for (const r of recipients) {
    try {
      await sendEmail({
        to: r.email,
        subject: `Complete your background check — Unit ${unitLabel}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6;max-width:520px;margin:0 auto">
          <p>Hello${r.name ? ` ${esc(r.name)}` : ''},</p>
          <p>Please complete your background check application for <strong>${esc(c.legal)}</strong>, Unit ${esc(unitLabel)}, using the link below:</p>
          <p style="text-align:center;margin:22px 0"><a href="${RENTVINE_APPLY_URL}" style="background:#f26a1b;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Start my background check →</a></p>
          <p style="color:#9ca3af;font-size:12px">If the button doesn't work, copy this link:<br>${RENTVINE_APPLY_URL}</p>
          <p>Thank you,<br>${esc(c.legal)}</p>
        </div>`,
      })
      sent.push(r.email)
    } catch { failed.push(r.email) }
  }

  if (sent.length) {
    await logOutboundCommunication({
      applicationId: id, associationCode: c.code, unitLabel: c.unit,
      subject: `Complete your background check — Unit ${unitLabel}`,
      body: `Sent the Rentvine application link (Checkr alternative) to: ${sent.join(', ')}.`,
      toEmails: sent, loggedBy: `staff:${session.displayName}`,
    })
  }

  return NextResponse.json({ ok: sent.length > 0, sent, failed })
}
