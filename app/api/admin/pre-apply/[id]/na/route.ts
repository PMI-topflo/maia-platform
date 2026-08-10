// POST /api/admin/pre-apply/[id]/na   { doc_key, na }
// Mark (or clear) a checklist item as "not applicable" — the applicant doesn't
// have it (e.g. no car → no vehicle registration). N/A items are excluded from
// the "missing required" gate. Stored as listing_applications.na_items (jsonb
// array of doc_keys). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  let b: { doc_key?: string; na?: boolean; stakeholder_id?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const docKey = String(b.doc_key ?? '').trim()
  if (!docKey) return NextResponse.json({ error: 'doc_key required' }, { status: 400 })
  // Per-applicant items are keyed doc_key#stakeholderId so N/A is per person.
  const sid = String(b.stakeholder_id ?? '').trim()
  const key = sid ? `${docKey}#${sid}` : docKey

  const { data: app } = await supabaseAdmin.from('listing_applications').select('na_items').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const cur = new Set((Array.isArray(app.na_items) ? app.na_items : []).map(String))
  if (b.na) cur.add(key); else cur.delete(key)
  const { error } = await supabaseAdmin.from('listing_applications').update({ na_items: [...cur], updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, naItems: [...cur] })
}
