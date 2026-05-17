// =====================================================================
// /api/admin/associations/[code]/documents/[id]
//
// DELETE — remove a document row + its storage object (if any).
// GET    — signed download URL for the storage object.
//
// Staff-only. Scoped by association_code AND id together so a URL
// typo can't reach into a different association.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_BUCKET } from '@/lib/association-documents'

export const dynamic = 'force-dynamic'

async function requireStaff() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return session
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const upperCode = code.toUpperCase()

  // Fetch first so we know whether there's a storage object to delete.
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('association_documents')
    .select('id, storage_path')
    .eq('id', id)
    .eq('association_code', upperCode)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!row)     return NextResponse.json({ error: 'Document not found for this association' }, { status: 404 })

  if (row.storage_path) {
    // Best-effort — if storage removal fails we still drop the DB row
    // so the UI stops listing the orphan. Storage cleanup can be done
    // later via a Supabase dashboard sweep.
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([row.storage_path]).catch(() => {})
  }

  const { error: delErr } = await supabaseAdmin
    .from('association_documents')
    .delete()
    .eq('id', id)
    .eq('association_code', upperCode)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function GET(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const { data: row, error } = await supabaseAdmin
    .from('association_documents')
    .select('storage_path, drive_url, filename')
    .eq('id', id)
    .eq('association_code', code.toUpperCase())
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row)  return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Drive link rows don't need a signed URL — caller already has the
  // external URL stored on the row. Return it as-is.
  if (row.drive_url) {
    return NextResponse.json({ url: row.drive_url, filename: row.filename, source: 'drive' })
  }
  if (!row.storage_path) {
    return NextResponse.json({ error: 'Document has no storage object' }, { status: 404 })
  }

  // Short-lived (5 min) signed URL — long enough to download, short
  // enough that it can't be casually shared after staff close the tab.
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(row.storage_path, 5 * 60, { download: row.filename })
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: `Could not sign URL: ${signErr?.message}` }, { status: 500 })
  }
  return NextResponse.json({ url: signed.signedUrl, filename: row.filename, source: 'upload' })
}
