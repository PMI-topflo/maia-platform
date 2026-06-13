// =====================================================================
// GET /api/admin/compliance/file?assoc=CODE&scope=association[&unit=REF]&item=KEY
// Redirects to a short-lived signed URL for the document filed against a
// compliance item (compliance_records.source_path). Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'association-documents'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const assoc = (sp.get('assoc') ?? '').trim().toUpperCase()
  const scope = sp.get('scope') === 'unit' ? 'unit' : 'association'
  const unit = (sp.get('unit') ?? '').trim()
  const item = (sp.get('item') ?? '').trim()
  if (!assoc || !item) return NextResponse.json({ error: 'assoc and item are required' }, { status: 400 })

  let q = supabaseAdmin.from('compliance_records').select('source_path')
    .eq('association_code', assoc).eq('scope', scope).eq('item_key', item)
  if (scope === 'unit') q = q.eq('unit_ref', unit)
  const { data } = await q.maybeSingle()
  const path = data?.source_path as string | null
  if (!path) return NextResponse.json({ error: 'no document on file for this item' }, { status: 404 })

  const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 10)
  if (!signed?.signedUrl) return NextResponse.json({ error: 'could not sign the document' }, { status: 502 })
  return NextResponse.redirect(signed.signedUrl)
}
