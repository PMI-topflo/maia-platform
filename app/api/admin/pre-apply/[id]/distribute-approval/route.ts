// POST /api/admin/pre-apply/[id]/distribute-approval
// (Re-)send the SIGNED board approval letter to every party — applicant, owner,
// agents, the board members who signed, the on-site manager, PMI + Jonathan, all
// BCC'd, with the PDF attached. Normally this fires automatically when the last
// board member signs; this endpoint covers letters signed before that automation
// existed, a party added later, or a recipient who lost the email. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getEsignDoc } from '@/lib/esign'
import { distributeApprovalLetter } from '@/lib/approval-distribution'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, unit_label').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'application not found' }, { status: 404 })

  // The most recent FULLY SIGNED board decision for this unit.
  const { data: row } = await supabaseAdmin.from('esign_documents')
    .select('id').eq('kind', 'board_decision').eq('association_code', String(app.association_code))
    .eq('unit_ref', String(app.unit_label ?? '')).eq('status', 'completed')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (!row) return NextResponse.json({ error: 'No fully-signed approval letter for this unit yet — the board must finish signing first.' }, { status: 400 })

  const doc = await getEsignDoc(String(row.id))
  if (!doc) return NextResponse.json({ error: 'Could not load the signed letter.' }, { status: 500 })

  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { renderFormPdf } = await import('@/lib/esign-forms')
  const el = renderFormPdf(doc)
  if (!el) return NextResponse.json({ error: 'Could not render the letter.' }, { status: 500 })
  const pdf = Buffer.from(await renderToBuffer(el))

  try {
    const { sent } = await distributeApprovalLetter({ doc, applicationId: id, pdf })
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return NextResponse.json({ error: `Could not send: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
