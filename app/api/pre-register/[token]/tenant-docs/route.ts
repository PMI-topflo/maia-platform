// =====================================================================
// POST /api/pre-register/[token]/tenant-docs   (multipart: file, docType, verificationId)
//
// A self-identified tenant uploads their lease or board-approval-letter
// right after submitting the pre-registration form — before staff have even
// looked at it. Re-verifies the same pre-register token (phone-scoped) and
// cross-checks the verification row belongs to that same phone's submission,
// so the verificationId alone can't be reused to upload onto someone else's.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyPreregisterToken } from '@/lib/preregister-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeStatus, type TenantVerificationRow } from '@/lib/tenant-verification'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'tenant-verification-docs'
const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i
const DOC_TYPES = ['lease', 'board_letter'] as const
type DocType = (typeof DOC_TYPES)[number]

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const claims = await verifyPreregisterToken(token)
  if (!claims) return NextResponse.json({ error: 'This link is invalid or has expired.' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const verificationId = String(form.get('verificationId') ?? '').trim()
  const docType = String(form.get('docType') ?? '').trim() as DocType
  const file = form.get('file')
  if (!verificationId) return NextResponse.json({ error: 'missing verificationId' }, { status: 400 })
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: 'invalid docType' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'unsupported file type' }, { status: 400 })

  const { data: v } = await supabaseAdmin.from('tenant_verifications')
    .select('id, pre_registration_id, lease_path, lease_source, board_letter_path, board_letter_source, owner_confirmed, status')
    .eq('id', verificationId).maybeSingle()
  if (!v) return NextResponse.json({ error: 'verification not found' }, { status: 404 })

  const { data: pr } = await supabaseAdmin.from('pre_registrations').select('phone').eq('id', v.pre_registration_id).maybeSingle()
  if (!pr || pr.phone !== claims.phone) return NextResponse.json({ error: 'not authorized for this verification' }, { status: 403 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: `file over 25 MB` }, { status: 400 })
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  const path = `${verificationId}/${docType}-${Date.now()}-${safe}`
  const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  const row = v as unknown as TenantVerificationRow
  const nextRow: TenantVerificationRow = {
    ...row,
    lease_path: docType === 'lease' ? path : row.lease_path,
    lease_source: docType === 'lease' ? 'tenant' : row.lease_source,
    board_letter_path: docType === 'board_letter' ? path : row.board_letter_path,
    board_letter_source: docType === 'board_letter' ? 'tenant' : row.board_letter_source,
  }
  const status = computeStatus(nextRow)

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (docType === 'lease') { update.lease_path = path; update.lease_source = 'tenant'; update.lease_uploaded_at = new Date().toISOString() }
  else { update.board_letter_path = path; update.board_letter_source = 'tenant'; update.board_letter_uploaded_at = new Date().toISOString() }

  await supabaseAdmin.from('tenant_verifications').update(update).eq('id', verificationId)

  return NextResponse.json({
    ok: true, status,
    hasLease: !!nextRow.lease_path, hasBoardLetter: !!nextRow.board_letter_path,
  })
}
