// =====================================================================
// POST /api/admin/unit-status/manual-upload   (staff-only, multipart)
// fields: file, assoc, account, unitLabel?, itemKey
// Staff already knows which unit + document type this is — skip MAIA's
// AI classification (which could mis-match the same way unit_number
// ambiguity did) and land it directly in the Document Inbox review queue
// with the staff's own selections pre-filled, same as every other upload
// path (still requires a final "Apply" click there).
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { categoriesForScope } from '@/lib/compliance-taxonomy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'association-documents'
const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i
const UNIT_ITEM_KEYS = new Set(categoriesForScope('unit').flatMap(c => c.items.map(i => i.key)))

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : 'staff'

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const assoc = String(form.get('assoc') ?? '').trim()
  const account = String(form.get('account') ?? '').trim()
  const unitLabel = String(form.get('unitLabel') ?? '').trim()
  const itemKey = String(form.get('itemKey') ?? '').trim()
  const file = form.get('file')

  if (!assoc || !account) return NextResponse.json({ error: 'pick an association and unit' }, { status: 400 })
  if (!UNIT_ITEM_KEYS.has(itemKey)) return NextResponse.json({ error: 'pick a document type' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'no file' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'unsupported file type' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'file over 25 MB' }, { status: 400 })
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  const path = `_inbox/manual-${account}-${Date.now()}-${safe}`
  const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf', upsert: true })
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 })

  const category = itemKey.split('.')[0] || 'unit'
  const { error } = await supabaseAdmin.from('document_intake').insert({
    storage_path: path, filename: file.name, mime_type: file.type || 'application/pdf', status: 'review',
    suggested_association_code: assoc, suggested_category: category, suggested_item_key: itemKey,
    suggested_scope: 'unit', suggested_unit_ref: account, suggested_unit_label: unitLabel || account,
    confidence: 1, summary: `Manually uploaded by staff for unit ${unitLabel || account}`, uploaded_by: me,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
