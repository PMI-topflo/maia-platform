// POST /api/admin/pre-apply/[id]/upload-url   { doc_key, filename }
// Signed upload URL so the browser PUTs the file straight to Supabase Storage,
// bypassing this Vercel function's request-body limit entirely. Staff-only.
//
// Companion to /api/admin/pre-apply/[id]/upload, which used to receive the raw
// file as multipart form data — Vercel's default Node function body cap
// (well under most real signed lease / purchase agreement PDFs) rejected the
// request before it ever reached that handler, surfacing as a client-side
// JSON-parse crash on Vercel's own plain-text "Request Entity Too Large" body.
// Found live, 2026-08-19, MANXI 303's Purchase Agreement. Mirrors the exact
// pattern /api/pre-apply/[token]/upload-url already uses for the applicant's
// own intake link.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { doc_key?: string; filename?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim().replace(/[^\w-]+/g, '_')
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })
  const filename = String(b.filename ?? '')
  if (!ALLOWED.test(filename)) return NextResponse.json({ error: 'file must be a PDF or image' }, { status: 400 })
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `intake/${id}/${docKey}/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })
  return NextResponse.json({ bucket: INTAKE_BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
