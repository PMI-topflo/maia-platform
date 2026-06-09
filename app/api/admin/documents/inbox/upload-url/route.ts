// POST /api/admin/documents/inbox/upload-url
// Signed upload URL for a Document Inbox staging file (before MAIA knows
// which association it belongs to). Lands under _inbox/. Staff-only.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

export async function POST(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { filename?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const filename = (body.filename ?? '').trim()
  if (!filename) return NextResponse.json({ error: 'filename is required' }, { status: 400 })

  const safe = filename.replace(/[^\w\-.]/g, '_').slice(0, 120)
  const path = `_inbox/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safe}`
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) return NextResponse.json({ error: `could not get upload URL: ${error?.message ?? 'no token'}` }, { status: 500 })
  return NextResponse.json({ storage_path: path, signed_url: data.signedUrl, token: data.token })
}
