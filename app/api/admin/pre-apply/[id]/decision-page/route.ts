// POST /api/admin/pre-apply/[id]/decision-page
//   { email, name?, decision?, conditions? }
// Creates a Board Decision Page e-sign document for this application and returns
// the signing link (send it to the board member / authorized approver). When
// they e-sign (verified), it's the formal decision record. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { signEsignToken } from '@/lib/esign-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { email?: string; name?: string; decision?: string; conditions?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const email = String(b.email ?? '').trim()
  if (!email.includes('@')) return NextResponse.json({ error: 'A signer email is required.' }, { status: 400 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label, approved_by_role').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name').eq('association_code', String(app.association_code)).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', id).eq('role', 'applicant').eq('is_primary', true).maybeSingle(),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || String(app.association_code)

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'board_decision', association_code: String(app.association_code), unit_ref: app.unit_label,
    title: `Board Decision — Unit ${app.unit_label ?? ''}`.trim(),
    payload: {
      associationLegalName: legal, applicant: sh?.name ?? null, unit: app.unit_label,
      applicationType: app.application_type, decision: b.decision?.trim() || 'Approved',
      conditions: b.conditions?.trim() || null,
    },
    signers: [{ role: 'approver', name: b.name?.trim() || null, email, phone: null }],
    status: 'sent', created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create: ${error?.message ?? 'unknown'}` }, { status: 500 })

  // Link the decision document to the application for the audit trail.
  await supabaseAdmin.from('listing_applications').update({ review_note: `Board Decision Page sent to ${email}` , updated_at: new Date().toISOString() }).eq('id', id)

  const link = `${APP}/esign/${await signEsignToken(created.id, 'approver')}`
  return NextResponse.json({ ok: true, docId: created.id, link, signerEmail: email })
}
