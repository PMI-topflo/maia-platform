// POST /api/admin/intake-documents/template
//   { associationCode, applicationType, docKey, filename }  → { signedUrl, path }
//   { associationCode, applicationType, docKey, path }      → commit: sets template_path
// DELETE ?associationCode=&applicationType=&docKey=         → clears it
//
// An EXAMPLE of a requested document, attached once and reused forever.
//
// "Please send me an example of this document you want" is the most common
// reply to a document request, and until now there was no way to answer it
// except by hand: template_path existed on the checklist and was rendered on
// the upload page, but nothing in the product could SET it — the handful of
// examples on file had been placed directly in the bucket.
//
// Setting it here means the next request email for that item carries the
// example automatically, for every association that asks for it. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { isApplicationType } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)

interface Body {
  associationCode?: string; applicationType?: string; docKey?: string
  filename?: string; path?: string
}

/** The one row this template belongs to. Templates are per association +
 *  application type + document, because the same doc_key can legitimately
 *  differ between a lease and a purchase. */
async function target(b: Body) {
  const code = String(b.associationCode ?? '').trim().toUpperCase()
  const type = String(b.applicationType ?? '').trim()
  const docKey = String(b.docKey ?? '').trim()
  if (!code || !docKey || !isApplicationType(type)) return null
  return { code, type, docKey }
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: Body
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const t = await target(b)
  if (!t) return NextResponse.json({ error: 'associationCode, a valid applicationType and docKey are required' }, { status: 400 })

  // Step 2 — commit a path that was just uploaded.
  if (b.path) {
    const path = String(b.path)
    if (!path.startsWith(`templates/${t.code}/`)) {
      return NextResponse.json({ error: 'path outside this association’s template folder' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('association_intake_documents')
      .update({ template_path: path, updated_at: new Date().toISOString() })
      .eq('association_code', t.code).eq('application_type', t.type).eq('doc_key', t.docKey)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, path })
  }

  // Step 1 — hand back a signed upload URL. The doc_key is in the filename so
  // the bucket stays readable by a human looking for "what example did we send
  // them for the HO-6 policy?".
  const filename = safe(String(b.filename ?? 'example'))
  const path = `templates/${t.code}/${t.type}/${t.docKey}-${Date.now()}-${filename}`
  const { data, error } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'could not create upload url' }, { status: 500 })
  return NextResponse.json({ signedUrl: data.signedUrl, path })
}

export async function DELETE(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams
  const t = await target({
    associationCode: q.get('associationCode') ?? undefined,
    applicationType: q.get('applicationType') ?? undefined,
    docKey: q.get('docKey') ?? undefined,
  })
  if (!t) return NextResponse.json({ error: 'associationCode, a valid applicationType and docKey are required' }, { status: 400 })
  // The file itself is left in the bucket: an example already emailed to an
  // owner should not 404 for them because staff swapped it later.
  const { error } = await supabaseAdmin.from('association_intake_documents')
    .update({ template_path: null, updated_at: new Date().toISOString() })
    .eq('association_code', t.code).eq('application_type', t.type).eq('doc_key', t.docKey)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
