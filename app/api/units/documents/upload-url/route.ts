// POST /api/units/documents/upload-url  { account, filename }
// One-time signed upload URL so the browser PUTs the file directly to
// Supabase Storage (bypasses Vercel's 4.5 MB body limit). Server picks
// the path. Requires upload permission (board / staff / manager with
// can_upload). The metadata POST to /submit follows once the file lands.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'

export const dynamic = 'force-dynamic'
const BUCKET = 'association-documents'

export async function POST(req: Request) {
  let body: { account?: string; filename?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.canUpload) return NextResponse.json({ error: 'You do not have upload permission for this association.' }, { status: 403 })

  const account = String(body.account ?? '').trim()
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const safe = String(body.filename ?? 'upload').replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `unit-submissions/${auth.assoc}/${account}/${crypto.randomUUID()}_${safe}`

  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: `could not create upload URL: ${error?.message ?? 'unknown'}` }, { status: 500 })

  return NextResponse.json({ bucket: BUCKET, path, token: data.token, signedUrl: data.signedUrl })
}
