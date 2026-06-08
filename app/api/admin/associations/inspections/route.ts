// =====================================================================
// GET  /api/admin/associations/inspections?assoc=CODE → active inspections
// POST /api/admin/associations/inspections            → create one
// Compliance certs (SB-4D, reserve study, fire, elevator) for the
// Association Hub Inspections tab. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT = 'id, association_code, inspection_type, last_done, next_due, inspector, notes, active'

async function requireStaff() {
  const cookieStore = await cookies()
  const token   = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}
const dateOrNull = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('association_inspections').select(SELECT)
    .eq('association_code', assoc).eq('active', true)
    .order('next_due', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inspections: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const assoc = String(body.association_code ?? '').trim().toUpperCase()
  const type  = String(body.inspection_type ?? '').trim()
  if (!assoc || !type) return NextResponse.json({ error: 'association_code and inspection_type are required' }, { status: 400 })
  const createdBy = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { data, error } = await supabaseAdmin.from('association_inspections').insert({
    association_code: assoc, inspection_type: type,
    last_done: dateOrNull(body.last_done),
    next_due:  dateOrNull(body.next_due),
    inspector: String(body.inspector ?? '').trim() || null,
    notes:     String(body.notes ?? '').trim() || null,
    created_by: createdBy,
  }).select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inspection: data })
}
