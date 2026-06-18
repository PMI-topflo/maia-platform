// =====================================================================
// GET /api/admin/personas?type=&assoc=&q=&limit=   (staff-only)
//
// Unified, normalized list of people MAIA knows — owners, tenants, board
// members, agents (from Supabase) and vendors (from CINC). Powers the
// Personas hub. Filterable by association (or ALL) and a free-text search.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listVendorsFull, listVendorsForAssociation } from '@/lib/integrations/cinc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export type PersonaType = 'owners' | 'tenants' | 'vendors' | 'board' | 'agents'

export interface PersonaRow {
  name: string
  email: string | null
  phone: string | null
  associationCode: string | null
  associationName: string | null
  sub: string | null          // unit / role / trade
  href: string | null         // where to manage this persona
}

const firstEmail = (e: unknown) => typeof e === 'string' ? (e.split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null) : null
const full = (a?: unknown, b?: unknown) => [a, b].filter(Boolean).join(' ').trim() || '(no name)'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const type = (url.searchParams.get('type') ?? 'owners') as PersonaType
  const assoc = (url.searchParams.get('q') ? '' : url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const q = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(500, Math.max(10, parseInt(url.searchParams.get('limit') ?? '200', 10) || 200))
  const like = `%${q}%`

  let rows: PersonaRow[] = []

  if (type === 'owners') {
    let sb = supabaseAdmin.from('owners').select('account_number, association_code, association_name, first_name, last_name, emails, phone, unit_number, status').or('status.neq.previous,status.is.null').limit(limit)
    if (assoc) sb = sb.eq('association_code', assoc)
    if (q) sb = sb.or(`first_name.ilike.${like},last_name.ilike.${like},emails.ilike.${like},unit_number.ilike.${like}`)
    const { data } = await sb
    rows = (data ?? []).map(o => ({
      name: full(o.first_name, o.last_name), email: firstEmail(o.emails), phone: (o.phone as string | null) ?? null,
      associationCode: (o.association_code as string | null) ?? null, associationName: (o.association_name as string | null) ?? null,
      sub: o.unit_number ? `Unit ${o.unit_number}` : null, href: '/admin/owners',
    }))
  } else if (type === 'tenants') {
    let sb = supabaseAdmin.from('association_tenants').select('first_name, last_name, association_code, association_name, email, phone, unit_number, status').or('status.neq.previous,status.is.null').limit(limit)
    if (assoc) sb = sb.eq('association_code', assoc)
    if (q) sb = sb.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},unit_number.ilike.${like}`)
    const { data } = await sb
    rows = (data ?? []).map(t => ({
      name: full(t.first_name, t.last_name), email: (t.email as string | null) ?? null, phone: (t.phone as string | null) ?? null,
      associationCode: (t.association_code as string | null) ?? null, associationName: (t.association_name as string | null) ?? null,
      sub: t.unit_number ? `Unit ${t.unit_number}` : null, href: '/admin/tenancy-history',
    }))
  } else if (type === 'board') {
    let sb = supabaseAdmin.from('association_board_members').select('name, email, role, association_code').eq('active', true).limit(limit)
    if (assoc) sb = sb.eq('association_code', assoc)
    if (q) sb = sb.or(`name.ilike.${like},email.ilike.${like},role.ilike.${like}`)
    const { data } = await sb
    rows = (data ?? []).map(b => ({
      name: (b.name as string | null) ?? '(no name)', email: (b.email as string | null) ?? null, phone: null,
      associationCode: (b.association_code as string | null) ?? null, associationName: null,
      sub: (b.role as string | null) ?? null, href: '/admin/board-setup',
    }))
  } else if (type === 'agents') {
    let sb = supabaseAdmin.from('real_estate_agents').select('first_name, last_name, email, phone').limit(limit)
    if (q) sb = sb.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    const { data } = await sb
    rows = (data ?? []).map(a => ({
      name: full(a.first_name, a.last_name), email: (a.email as string | null) ?? null, phone: (a.phone as string | null) ?? null,
      associationCode: null, associationName: null, sub: null, href: '/admin/registrations',
    }))
  } else if (type === 'vendors') {
    // Vendor master data lives in CINC. With an association selected we scope to
    // that association's vendors (CINC's Vendor-Association screen); otherwise we
    // list/search the whole CINC catalog. Either way we enrich from the full
    // catalog so email / phone / address show up (the scoped endpoint is minimal).
    const vendorAssoc = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
    const all = await listVendorsFull().catch(() => [])
    const ql = q.toLowerCase()
    const matchQ = (v: { VendorName: string; Dba?: string | null; CheckName?: string | null; Email?: string | null; Phone1?: string | null; Address1?: string | null; City?: string | null }) =>
      !q || [v.VendorName, v.Dba, v.CheckName, v.Email, v.Phone1, v.Address1, v.City].some(f => (f ?? '').toLowerCase().includes(ql))

    let pool: (typeof all) = all
    let assocName: string | null = null
    if (vendorAssoc) {
      const scoped = await listVendorsForAssociation(vendorAssoc).catch(() => [])
      const byId = new Map(all.map(v => [v.VendorId, v]))
      // Prefer the rich record; fall back to a minimal one for any vendor not yet
      // in the full catalog (e.g. a brand-new vendor not recached).
      pool = scoped.map(s => byId.get(s.VendorId) ?? ({ VendorId: s.VendorId, VendorName: s.VendorName } as (typeof all)[number]))
      const { data: a } = await supabaseAdmin.from('associations').select('association_name').eq('association_code', vendorAssoc).maybeSingle()
      assocName = (a?.association_name as string | null) ?? vendorAssoc
    }

    const matched = pool.filter(matchQ).slice(0, limit)
    rows = matched.map(v => ({
      name: v.VendorName + (v.Dba ? ` (dba ${v.Dba})` : ''), email: v.Email ?? null, phone: v.Phone1 ?? null,
      associationCode: vendorAssoc || null, associationName: vendorAssoc ? assocName : null,
      sub: [v.Address1, v.City, v.State].filter(Boolean).join(', ') || null, href: '/admin/vendor-compliance',
    }))
    return NextResponse.json({ type, rows, vendorsAllScope: !vendorAssoc })
  }

  return NextResponse.json({ type, rows, vendorsAllScope: false })
}
