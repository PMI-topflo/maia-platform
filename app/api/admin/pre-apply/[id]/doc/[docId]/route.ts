// One imported/uploaded application document.
//   GET    → 302 redirect to a FRESH signed view URL (so links never expire).
//   DELETE → "ignore": remove this document from the application.
//   PATCH  → update the reviewed expiration date / suggested name.
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { INTAKE_BUCKET } from '@/lib/preapply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function loadDoc(id: string, docId: string) {
  const { data } = await supabaseAdmin.from('application_documents')
    .select('id, application_id, storage_path').eq('id', docId).eq('application_id', id).maybeSingle()
  return data
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, docId } = await ctx.params
  const doc = await loadDoc(id, docId)
  if (!doc?.storage_path) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const { data } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(String(doc.storage_path), 60 * 10)
  if (!data?.signedUrl) return NextResponse.json({ error: 'could not sign' }, { status: 502 })
  return NextResponse.redirect(data.signedUrl)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, docId } = await ctx.params
  const { error } = await supabaseAdmin.from('application_documents').delete().eq('id', docId).eq('application_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, docId } = await ctx.params
  let b: { expiration_date?: string | null; suggested_name?: string; no_expiration?: boolean; stakeholder_id?: string | null; doc_key?: string; doc_label?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  // Re-file a document onto a DIFFERENT checklist item. The scan classifies by
  // content and sometimes gets it wrong — three pages of one lease can land on
  // three different items — so staff must be able to correct it after opening
  // the file, without deleting and re-uploading.
  if (typeof b.doc_key === 'string' && b.doc_key.trim()) {
    patch.doc_key = b.doc_key.trim()
    if (typeof b.doc_label === 'string' && b.doc_label.trim()) patch.doc_label = b.doc_label.trim()
  }
  if ('expiration_date' in b) patch.expiration_date = (b.expiration_date && /^\d{4}-\d{2}-\d{2}$/.test(b.expiration_date)) ? b.expiration_date : null
  if (typeof b.suggested_name === 'string') patch.suggested_name = b.suggested_name.trim() || null
  if (typeof b.no_expiration === 'boolean') { patch.no_expiration = b.no_expiration; if (b.no_expiration) patch.expiration_date = null }
  // Reassign the document to a different applicant (or to the shared column, null).
  if ('stakeholder_id' in b) patch.stakeholder_id = b.stakeholder_id ? String(b.stakeholder_id) : null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  const { error } = await supabaseAdmin.from('application_documents').update(patch).eq('id', docId).eq('application_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
