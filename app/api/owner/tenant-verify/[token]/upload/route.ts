// =====================================================================
// POST /api/owner/tenant-verify/[token]/upload   (multipart: file, docType)
// (token-gated; no session)
// The owner uploads the lease or board-approval-letter on the tenant's
// behalf, for whichever is still missing.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyTenantVerifyToken } from '@/lib/tenant-verification-token'
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
  const verificationId = await verifyTenantVerifyToken(token)
  if (!verificationId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const docType = String(form.get('docType') ?? '').trim() as DocType
  const file = form.get('file')
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: 'invalid docType' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'unsupported file type' }, { status: 400 })

  const { data: v } = await supabaseAdmin.from('tenant_verifications')
    .select('id, lease_path, lease_source, board_letter_path, board_letter_source, owner_confirmed, status')
    .eq('id', verificationId).maybeSingle()
  if (!v) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'file over 25 MB' }, { status: 400 })
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  const path = `${verificationId}/${docType}-${Date.now()}-${safe}`
  const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  const row = v as unknown as TenantVerificationRow
  const nextRow: TenantVerificationRow = {
    ...row,
    lease_path: docType === 'lease' ? path : row.lease_path,
    lease_source: docType === 'lease' ? 'owner' : row.lease_source,
    board_letter_path: docType === 'board_letter' ? path : row.board_letter_path,
    board_letter_source: docType === 'board_letter' ? 'owner' : row.board_letter_source,
  }
  const status = computeStatus(nextRow)
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (docType === 'lease') { update.lease_path = path; update.lease_source = 'owner'; update.lease_uploaded_at = new Date().toISOString() }
  else { update.board_letter_path = path; update.board_letter_source = 'owner'; update.board_letter_uploaded_at = new Date().toISOString() }

  await supabaseAdmin.from('tenant_verifications').update(update).eq('id', verificationId)

  return NextResponse.json({ ok: true, status, hasLease: !!nextRow.lease_path, hasBoardLetter: !!nextRow.board_letter_path })
}
