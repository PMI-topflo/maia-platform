// GET  /api/admin/intake-documents?code=CODE  → the per-type intake checklist.
// POST /api/admin/intake-documents  { code, application_type, doc_key, label, provided_by?, required?, note?, sort_order? }
//   → add/update a checklist row (upsert on association+type+doc_key). Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { getIntakeChecklistAll, isApplicationType, APPLICATION_TYPES, PROVIDED_BY_LABEL, type ProvidedBy } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  return NextResponse.json({ types: APPLICATION_TYPES, checklist: await getIntakeChecklistAll(code) })
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: { code?: string; application_type?: string; doc_key?: string; label?: string; provided_by?: string; required?: boolean; note?: string; sort_order?: number }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.code ?? '').trim().toUpperCase()
  const type = String(b.application_type ?? '').trim()
  const docKey = String(b.doc_key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  const label = String(b.label ?? '').trim()
  const providedBy = (['applicant', 'landlord', 'agent'].includes(String(b.provided_by)) ? b.provided_by : 'applicant') as ProvidedBy
  if (!code || !isApplicationType(type) || !docKey || !label) {
    return NextResponse.json({ error: 'code, valid application_type, doc_key and label required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('association_intake_documents').upsert({
    association_code: code, application_type: type, doc_key: docKey, label,
    provided_by: providedBy, required: b.required !== false, note: b.note?.trim() || null,
    sort_order: typeof b.sort_order === 'number' ? b.sort_order : 99, active: true,
    created_by: `staff:${session.displayName}`, updated_at: new Date().toISOString(),
  }, { onConflict: 'association_code,application_type,doc_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, providerLabels: PROVIDED_BY_LABEL })
}
