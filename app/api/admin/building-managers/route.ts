// GET /api/admin/building-managers?assoc=CODE   → active on-site managers
// POST /api/admin/building-managers  { association_code, entries: [{name?, email, phone?, company_name?}] }
//   → bulk-add on-site managers (building_managers). Skips emails already on
//     file. Name defaults to the email's local part when not given (so a plain
//     list of emails works).
// PATCH /api/admin/building-managers  { id, active }  → activate/deactivate.
// Staff-only. On-site managers are association/building-wide — distinct from
// unit_managers (an owner's per-unit manager).

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? name, last: parts.slice(1).join(' ') || '' }
}

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') || '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc required' }, { status: 400 })
  const { data } = await supabaseAdmin.from('building_managers')
    .select('id, first_name, last_name, email, phone, company_name, active')
    .eq('association_code', assoc).order('created_at', { ascending: true })
  return NextResponse.json({ managers: data ?? [] })
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { association_code?: string; entries?: { name?: string; email?: string; phone?: string; company_name?: string }[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const assoc = String(body.association_code ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'association_code required' }, { status: 400 })

  // Normalize + de-dupe input by email.
  const seen = new Set<string>()
  const clean = (body.entries ?? [])
    .map(e => ({ name: (e.name ?? '').trim(), email: (e.email ?? '').trim().toLowerCase(), phone: (e.phone ?? '').trim(), company_name: (e.company_name ?? '').trim() }))
    .filter(e => e.email.includes('@') && !seen.has(e.email) && seen.add(e.email))
  if (clean.length === 0) return NextResponse.json({ error: 'No valid email addresses.' }, { status: 400 })

  // Skip any already on file for this association.
  const { data: existing } = await supabaseAdmin.from('building_managers')
    .select('email').eq('association_code', assoc)
  const have = new Set((existing ?? []).map(r => String(r.email ?? '').trim().toLowerCase()).filter(Boolean))

  const rows = clean.filter(e => !have.has(e.email)).map(e => {
    const nm = e.name || e.email.split('@')[0]
    const { first, last } = splitName(nm)
    return { first_name: first, last_name: last, email: e.email, phone: e.phone || null, association_code: assoc, company_name: e.company_name || null, active: true }
  })
  if (rows.length === 0) return NextResponse.json({ ok: true, added: 0, skipped: clean.length })

  const { error } = await supabaseAdmin.from('building_managers').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, added: rows.length, skipped: clean.length - rows.length })
}

export async function PATCH(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { id?: string; active?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('building_managers').update({ active: !!body.active }).eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
