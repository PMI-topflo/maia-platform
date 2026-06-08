// =====================================================================
// GET  /api/admin/associations/projects?assoc=CODE  → active projects
// POST /api/admin/associations/projects             → create one
// Capital / large projects for the Association Hub Projects tab. Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT = 'id, association_code, name, status, vendor_name, budget, spent, target_date, pct_complete, notes, active'
const STATUSES = ['planning', 'bidding', 'in_progress', 'on_hold', 'complete']

async function requireStaff() {
  const cookieStore = await cookies()
  const token   = cookieStore.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }

export async function GET(req: Request) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('association_projects').select(SELECT)
    .eq('association_code', assoc).eq('active', true)
    .order('target_date', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ projects: data ?? [] })
}

export async function POST(req: Request) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const assoc = String(body.association_code ?? '').trim().toUpperCase()
  const name  = String(body.name ?? '').trim()
  if (!assoc || !name) return NextResponse.json({ error: 'association_code and name are required' }, { status: 400 })
  const status = STATUSES.includes(String(body.status)) ? String(body.status) : 'planning'
  const createdBy = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : null

  const { data, error } = await supabaseAdmin.from('association_projects').insert({
    association_code: assoc, name, status,
    vendor_name:  String(body.vendor_name ?? '').trim() || null,
    budget:       num(body.budget),
    spent:        num(body.spent),
    target_date:  /^\d{4}-\d{2}-\d{2}$/.test(String(body.target_date)) ? String(body.target_date) : null,
    pct_complete: Math.min(100, Math.max(0, Number(body.pct_complete ?? 0) || 0)),
    notes:        String(body.notes ?? '').trim() || null,
    created_by:   createdBy,
  }).select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}
