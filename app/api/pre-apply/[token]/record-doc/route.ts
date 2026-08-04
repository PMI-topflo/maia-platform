// POST /api/pre-apply/[token]/record-doc
//   { doc_key, doc_label, storage_path, filename, mime_type }
// Records an uploaded intake document against its checklist item. Token auth.

import { NextResponse } from 'next/server'
import { verifyPreApplyToken } from '@/lib/preapply-token'
import { getIntake, recordIntakeDoc } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyPreApplyToken(token)
  if (!t) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const intake = await getIntake(t.applicationId)
  if (!intake) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (intake.submittedAt) return NextResponse.json({ error: 'This application has already been submitted.' }, { status: 400 })
  if (!intake.emailVerifiedAt) return NextResponse.json({ error: 'Please verify your email before uploading.' }, { status: 403 })

  let b: { doc_key?: string; doc_label?: string; storage_path?: string; filename?: string; mime_type?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  const path = String(b.storage_path ?? '').trim()
  if (!docKey || !path) return NextResponse.json({ error: 'doc_key and storage_path required' }, { status: 400 })
  if (!path.startsWith(`intake/${t.applicationId}/`)) return NextResponse.json({ error: 'path mismatch' }, { status: 400 })

  const res = await recordIntakeDoc(t.applicationId, {
    doc_key: docKey, doc_label: String(b.doc_label ?? docKey), storage_path: path,
    filename: String(b.filename ?? 'upload'), mime_type: b.mime_type ?? null,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
