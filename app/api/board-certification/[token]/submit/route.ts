// POST /api/board-certification/[token]/submit
//   { storage_path, filename?, mime_type?, doc_type? }
// Files a PENDING board_member_certifications row from a self-upload. Staff
// confirm the document type + certificate date at approval time. Notifies
// the approvers. Token is the auth.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyBoardCertToken } from '@/lib/board-cert-token'
import { extractCertificateDate } from '@/lib/board-cert-extract'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const DOC_TYPES = new Set(['education_certificate', 'certification_form', 'continuing_education'])

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyBoardCertToken(token)
  if (!data) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { storage_path?: string; filename?: string; mime_type?: string; doc_type?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const path = String(body.storage_path ?? '').trim()
  if (!path) return NextResponse.json({ error: 'storage_path required' }, { status: 400 })
  if (!path.startsWith(`board-certifications/${data.assoc}/${data.memberId}/`)) {
    return NextResponse.json({ error: 'path mismatch' }, { status: 400 })
  }
  let docType = DOC_TYPES.has(String(body.doc_type)) ? String(body.doc_type) : 'education_certificate'

  const { data: member } = await supabaseAdmin.from('association_board_members')
    .select('id, name, email').eq('id', data.memberId).maybeSingle()

  // MAIA reads the completion date + confirms the document type, so it's
  // pre-filled when staff review this self-upload. Best-effort.
  let certDate: string | null = null
  let aiSummary: string | null = null
  const { data: blob } = await supabaseAdmin.storage.from('association-documents').download(path)
  if (blob) {
    const ex = await extractCertificateDate(Buffer.from(await blob.arrayBuffer()), body.mime_type ?? null)
    certDate = ex.completionDate
    if (ex.docType) docType = ex.docType
    if (ex.completionDate) aiSummary = `MAIA read completion date ${ex.completionDate}`
  }

  const { error } = await supabaseAdmin.from('board_member_certifications').insert({
    association_code:   data.assoc.toUpperCase(),
    board_member_id:    data.memberId,
    board_member_name:  member?.name ?? null,
    board_member_email: member?.email ?? null,
    doc_type:           docType,
    certificate_date:   certDate,
    storage_key:        path,
    filename:           body.filename ?? null,
    mime_type:          body.mime_type ?? null,
    ai_summary:         aiSummary,
    status:             'pending',
    uploaded_via:       'self',
    uploaded_by:        `board:${member?.name ?? data.memberId}`,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (NOTIFY.length) {
    void sendEmail({
      to: NOTIFY,
      subject: `Board certificate to review — ${data.assoc} (${member?.name ?? 'board member'})`,
      html: `<p><strong>${member?.name ?? 'A board member'}</strong> uploaded a board-education certificate for <strong>${data.assoc}</strong>.</p>
             <p>File: ${body.filename ?? '(unnamed)'}</p>
             <p><a href="${APP}/admin/cinc-sync/${data.assoc}">Open the association hub to confirm the type + date →</a></p>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true })
}
