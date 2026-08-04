// POST /api/units/board-certifications/submit
//   { memberId, doc_type, storage_path, filename?, mime_type?, assoc }
// Files a PENDING board_member_certifications row from an on-site manager /
// board-member upload on the /units audit. Staff confirm the type + date at
// approval time on the Association Hub. MAIA reads the completion date so it's
// pre-filled. Requires units upload permission.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { extractCertificateDate } from '@/lib/board-cert-extract'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const DOC_TYPES = new Set(['education_certificate', 'certification_form', 'continuing_education'])

export async function POST(req: Request) {
  let body: { memberId?: string; doc_type?: string; storage_path?: string; filename?: string; mime_type?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'no upload permission' }, { status: 403 })

  const memberId = String(body.memberId ?? '').trim()
  const path = String(body.storage_path ?? '').trim()
  if (!memberId || !path) return NextResponse.json({ error: 'memberId, storage_path required' }, { status: 400 })
  if (!path.startsWith(`board-certifications/${auth.assoc}/${memberId}/`)) {
    return NextResponse.json({ error: 'path mismatch' }, { status: 400 })
  }
  let docType = DOC_TYPES.has(String(body.doc_type)) ? String(body.doc_type) : 'education_certificate'

  const { data: member } = await supabaseAdmin.from('association_board_members')
    .select('id, name, email, association_code').eq('id', memberId).maybeSingle()
  if (!member || member.association_code.toUpperCase() !== auth.assoc.toUpperCase()) {
    return NextResponse.json({ error: 'board member not found for this association' }, { status: 404 })
  }

  // MAIA reads the completion date + confirms the type so it's pre-filled for
  // staff review. Best-effort — never blocks the upload.
  let certDate: string | null = null
  let aiSummary: string | null = null
  const { data: blob } = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (blob) {
    const ex = await extractCertificateDate(Buffer.from(await blob.arrayBuffer()), body.mime_type ?? null)
    certDate = ex.completionDate
    if (ex.docType) docType = ex.docType
    if (ex.completionDate) aiSummary = `MAIA read completion date ${ex.completionDate}`
  }

  const { error } = await supabaseAdmin.from('board_member_certifications').insert({
    association_code:   auth.assoc.toUpperCase(),
    board_member_id:    memberId,
    board_member_name:  member.name,
    board_member_email: member.email,
    doc_type:           docType,
    certificate_date:   certDate,
    storage_key:        path,
    filename:           body.filename ?? null,
    mime_type:          body.mime_type ?? null,
    ai_summary:         aiSummary,
    status:             'pending',
    uploaded_via:       'units',
    uploaded_by:        `${auth.persona}`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (NOTIFY.length) {
    void sendEmail({
      to: NOTIFY,
      subject: `Board certificate to review — ${auth.assoc} (${member.name ?? 'board member'})`,
      html: `<p><strong>${member.name ?? 'A board member'}</strong>'s board-education certificate was uploaded for <strong>${auth.assoc}</strong> from the units portal.</p>
             <p>File: ${body.filename ?? '(unnamed)'}</p>
             <p><a href="${APP}/admin/cinc-sync/${auth.assoc}">Open the association hub to confirm the type + date →</a></p>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
