// =====================================================================
// /api/admin/association-document-requirements   (staff-only)
// GET  → list custom per-association unit-level requirements (Association
//        Document Setup page + Document Inbox's item picker, which needs to
//        show these alongside the fixed taxonomy so staff can actually file
//        an uploaded custom-item doc against the right item).
//        ?all=true includes inactive ones (setup page only); default is
//        active-only (Document Inbox, dashboard).
// POST → create one. item_key is auto-namespaced under unit.custom_<slug>
//        so it inherits the existing 'unit' category everywhere (Document
//        Inbox's category/item pickers, requiredItemKeys() merging) without
//        needing a whole new top-level taxonomy category.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OCC_VALUES = ['owner_occupied', 'leased', 'vacant']

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item'
}

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  let q = supabaseAdmin.from('association_document_requirements').select('*').order('association_code').order('label')
  if (searchParams.get('all') !== 'true') q = q.eq('active', true)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requirements: data ?? [] })
}

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' ? session.userId : 'staff'

  let body: { associationCode?: string; label?: string; occupancyFilter?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const associationCode = String(body.associationCode ?? '').trim().toUpperCase()
  const label = String(body.label ?? '').trim()
  const occupancyFilter = body.occupancyFilter || null
  if (!associationCode) return NextResponse.json({ error: 'pick an association' }, { status: 400 })
  if (!label) return NextResponse.json({ error: 'enter a document label' }, { status: 400 })
  if (occupancyFilter && !OCC_VALUES.includes(occupancyFilter)) return NextResponse.json({ error: 'invalid occupancy filter' }, { status: 400 })

  const itemKey = `unit.custom_${slugify(label)}`
  const { data, error } = await supabaseAdmin.from('association_document_requirements').insert({
    association_code: associationCode, item_key: itemKey, label, occupancy_filter: occupancyFilter, created_by: me,
  }).select('*').single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A requirement with this label already exists for this association.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, requirement: data })
}
