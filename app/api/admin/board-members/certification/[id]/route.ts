// PATCH  /api/admin/board-members/certification/[id]
//   { decision: 'approve'|'reject', doc_type?, certificate_date?, note? }
//   → approve/reject a self-uploaded certificate; approving is when staff
//     confirms the document type and the certificate date (the date drives
//     the validity window).
// DELETE /api/admin/board-members/certification/[id] → remove a certificate.
// Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const dynamic = 'force-dynamic'
const DOC_TYPES = new Set(['education_certificate', 'certification_form', 'continuing_education'])

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let body: { decision?: string; doc_type?: string; certificate_date?: string; note?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const decision = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null
  if (!decision) return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 })

  const patch: Record<string, unknown> = {
    status:      decision,
    reviewed_by: `staff:${session.displayName}`,
    reviewed_at: new Date().toISOString(),
    review_note: body.note ?? null,
  }
  if (decision === 'approved') {
    if (body.doc_type) {
      if (!DOC_TYPES.has(body.doc_type)) return NextResponse.json({ error: 'invalid doc_type' }, { status: 400 })
      patch.doc_type = body.doc_type
    }
    if (body.certificate_date !== undefined) patch.certificate_date = body.certificate_date || null
  }

  const { error } = await supabaseAdmin.from('board_member_certifications').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: decision })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await supabaseAdmin.from('board_member_certifications').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
