// GET  /api/admin/pre-apply/[id]/sponsorship → who'd be asked, blockers, history
// POST /api/admin/pre-apply/[id]/sponsorship → ask the sitting tenant to sponsor
//
// The already-approved tenant is the right person to ask about somebody joining
// THEIR lease — not the owner, who often has never met them. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { sendEmail } from '@/lib/gmail'
import { renderMaiaEmail } from '@/lib/maia-email'
import { getCurrentLease, SPONSOR_ACKNOWLEDGMENT } from '@/lib/occupant-sponsorship'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SUPPORT = 'support@topfloridaproperties.com'

async function ctxFor(id: string) {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label, application_type').eq('id', id).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [lease, { data: assoc }, { data: people }] = await Promise.all([
    getCurrentLease(code, (app.unit_label as string | null) ?? null),
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name, email').eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }),
  ])
  return {
    code, unit: (app.unit_label as string | null) ?? null,
    type: String(app.application_type ?? ''),
    legal: (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code,
    address: [assoc?.principal_address, app.unit_label ? `Unit ${app.unit_label}` : null,
      [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null,
    lease,
    occupantName: String((people ?? [])[0]?.name ?? '').trim(),
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await ctxFor(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const blockers: string[] = []
  if (c.type !== 'additional_occupant') blockers.push('Sponsorship applies to an additional-occupant application.')
  if (!c.lease?.tenantEmail) blockers.push('No approved tenant with an email on file for this unit — MAIA has nobody to ask.')
  if (!c.occupantName) blockers.push('Add the occupant’s name first.')

  const { data: rows } = await supabaseAdmin.from('occupant_sponsorships')
    .select('id, tenant_name, tenant_email, occupant_name, responded_at, decision, occupant_email, occupant_phone, acknowledged, note, created_at, token')
    .eq('application_id', id).order('created_at', { ascending: false })

  return NextResponse.json({
    tenant: c.lease ? { name: c.lease.tenantName, email: c.lease.tenantEmail } : null,
    occupantName: c.occupantName, blockers, currentLease: c.lease,
    sponsorships: (rows ?? []).map(r => ({ ...r, link: `${APP}/sponsorship/${r.token}` })),
  })
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const c = await ctxFor(id)
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!c.lease?.tenantEmail) return NextResponse.json({ error: 'No approved tenant with an email on file for this unit.' }, { status: 400 })
  if (!c.occupantName) return NextResponse.json({ error: 'Add the occupant’s name first.' }, { status: 400 })

  const token = crypto.randomUUID()
  const { data: row, error } = await supabaseAdmin.from('occupant_sponsorships').insert({
    application_id: id, association_code: c.code, unit_label: c.unit, token,
    tenant_name: c.lease.tenantName, tenant_email: c.lease.tenantEmail,
    occupant_name: c.occupantName, created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !row) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const link = `${APP}/sponsorship/${token}`
  try {
    await sendEmail({
      to: [String(c.lease.tenantEmail)], replyTo: SUPPORT,
      subject: `Adding an occupant to your unit — ${c.unit ? `Unit ${c.unit}` : c.legal}`,
      html: renderMaiaEmail({
        associationName: c.legal, associationCode: c.code, unit: c.unit, propertyAddress: c.address,
        applicantNames: [c.occupantName], applicationType: 'Additional Occupant',
        heading: 'Please confirm this occupant',
        intro: `${c.occupantName} has been put forward as an additional occupant of your unit. Before the Board reviews it, we need you to confirm you are asking for them to be added — and to give us their OWN email address and phone number.\n\nTheir email must be different from yours: MAIA sends them their own forms to sign, and a signature has to be verified against the signer's own mailbox.`,
        items: [
          { label: 'Confirm you are requesting this occupant', whoFor: 'You' },
          { label: 'Their own email address', whoFor: 'Required', note: 'Must be different from yours' },
          { label: 'Their phone number', whoFor: 'Required' },
        ],
        ctaUrl: link,
        footerReason: `You're receiving this as the approved tenant of ${c.unit ? `Unit ${c.unit}` : 'this unit'}.`,
      }),
    })
  } catch (e) {
    return NextResponse.json({ error: `Created but could not email: ${e instanceof Error ? e.message : 'error'}`, link }, { status: 502 })
  }
  return NextResponse.json({ ok: true, sentTo: c.lease.tenantEmail, link, acknowledgment: SPONSOR_ACKNOWLEDGMENT })
}
