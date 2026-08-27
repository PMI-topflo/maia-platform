// POST /api/admin/pre-apply/extract-lease   { bucket, path }
// Staff-only. Reads a lease document staff is about to attach to a NEW
// application (before it exists) and returns what MAIA can make out of it —
// tenant names, email, phone, lease term — so the "Open an application" form
// can pre-fill the roster from the document instead of staff retyping what's
// already printed on the file they're attaching anyway. User direction,
// 2026-08-27 (a real owner-forwarded "fully executed lease" for a renewal).
//
// Takes a Storage path (from extract-lease-url's signed upload), not raw file
// bytes — a real signed lease routinely exceeds Vercel's function body limit,
// which surfaced as a plain-text "Request Entity Too Large" response the
// client's JSON parse choked on. Deletes the staged file once read; it's
// never a real application's document, just scratch for this read.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { extractLeaseDetails } from '@/lib/lease-extract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: { bucket?: string; path?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const bucket = String(b.bucket ?? '').trim()
  const path = String(b.path ?? '').trim()
  if (!bucket || !path) return NextResponse.json({ error: 'bucket + path required' }, { status: 400 })

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(path)
  if (dlErr || !blob) return NextResponse.json({ error: `could not read the uploaded file: ${dlErr?.message ?? 'unknown'}` }, { status: 500 })

  const buf = Buffer.from(await blob.arrayBuffer())
  const d = await extractLeaseDetails(buf, blob.type || 'application/pdf')

  supabaseAdmin.storage.from(bucket).remove([path]).catch(() => null)

  return NextResponse.json({ ok: true, ...d })
}
