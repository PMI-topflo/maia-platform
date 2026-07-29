// GET  /api/admin/board-members/certification?code=CODE
//   → per-member board-education standing for the association hub.
// POST /api/admin/board-members/certification
//   { code, memberId, storage_path, filename?, mime_type?, doc_type, certificate_date? }
//   → record a staff-uploaded certificate (auto-approved: staff is trusted).
// Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getBoardCertOverview } from '@/lib/board-certification-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOC_TYPES = new Set(['education_certificate', 'certification_form', 'continuing_education'])

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  return NextResponse.json(await getBoardCertOverview(code))
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string; memberId?: string; storage_path?: string; filename?: string; mime_type?: string; doc_type?: string; certificate_date?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code    = String(body.code ?? '').trim().toUpperCase()
  const memberId = String(body.memberId ?? '').trim()
  const path    = String(body.storage_path ?? '').trim()
  const docType = String(body.doc_type ?? '').trim()
  if (!code || !memberId || !path) return NextResponse.json({ error: 'code, memberId, storage_path required' }, { status: 400 })
  if (!DOC_TYPES.has(docType)) return NextResponse.json({ error: 'invalid doc_type' }, { status: 400 })
  if (!path.startsWith(`board-certifications/${code}/${memberId}/`)) return NextResponse.json({ error: 'path mismatch' }, { status: 400 })

  const { data: member } = await supabaseAdmin.from('association_board_members')
    .select('id, name, email, association_code').eq('id', memberId).maybeSingle()
  if (!member || member.association_code.toUpperCase() !== code) {
    return NextResponse.json({ error: 'board member not found' }, { status: 404 })
  }

  const { data: row, error } = await supabaseAdmin.from('board_member_certifications').insert({
    association_code:   code,
    board_member_id:    memberId,
    board_member_name:  member.name,
    board_member_email: member.email,
    doc_type:           docType,
    certificate_date:   body.certificate_date || null,
    storage_key:        path,
    filename:           body.filename ?? null,
    mime_type:          body.mime_type ?? null,
    status:             'approved',                 // staff upload is trusted
    uploaded_via:       'staff',
    uploaded_by:        `staff:${session.displayName}`,
    reviewed_by:        `staff:${session.displayName}`,
    reviewed_at:        new Date().toISOString(),
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: row.id })
}
