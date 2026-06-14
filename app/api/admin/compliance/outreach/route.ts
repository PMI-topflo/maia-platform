// =====================================================================
// GET /api/admin/compliance/outreach            → association summary
// GET /api/admin/compliance/outreach?assoc=CODE → per-unit outreach status
// Powers the Compliance Outreach page: who's been emailed, who clicked their
// link, and who has uploaded documents (received). Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requiredItemKeys, associationKind, type Occupancy } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const firstEmail = (e: string | null) => e ? (e.split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null) : null

async function staff() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return !!session && session.persona === 'staff'
}

export async function GET(req: Request) {
  if (!await staff()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()

  // ── Summary: associations + sent/clicked rollup ──────────────────────
  if (!assoc) {
    const [{ data: assocs }, { data: reqs }] = await Promise.all([
      supabaseAdmin.from('associations').select('association_code, association_name').order('association_name'),
      supabaseAdmin.from('owner_compliance_requests').select('association_code, last_sent_at, opened_at, resolved_at'),
    ])
    const agg = new Map<string, { sent: number; clicked: number; resolved: number }>()
    for (const r of reqs ?? []) {
      const a = agg.get(r.association_code as string) ?? { sent: 0, clicked: 0, resolved: 0 }
      if (r.last_sent_at) a.sent++
      if (r.opened_at) a.clicked++
      if (r.resolved_at) a.resolved++
      agg.set(r.association_code as string, a)
    }
    const rows = (assocs ?? []).map(a => ({
      code: String(a.association_code), name: String(a.association_name ?? a.association_code),
      ...(agg.get(String(a.association_code)) ?? { sent: 0, clicked: 0, resolved: 0 }),
    }))
    return NextResponse.json({ associations: rows })
  }

  // ── Detail: per-unit status for one association ──────────────────────
  const [{ data: ownerRows }, { data: occRows }, { data: recRows }, { data: reqRows }, kind, { data: assocRow }] = await Promise.all([
    supabaseAdmin.from('owners').select('account_number, unit_number, first_name, last_name, emails').eq('association_code', assoc).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_occupancy').select('unit_ref, status').eq('association_code', assoc),
    supabaseAdmin.from('compliance_records').select('unit_ref, item_key, status').eq('association_code', assoc).eq('scope', 'unit'),
    supabaseAdmin.from('owner_compliance_requests').select('unit_ref, last_sent_at, send_count, opened_at').eq('association_code', assoc),
    associationKind(assoc),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', assoc).maybeSingle(),
  ])

  // Group owners into units (one row per physical unit).
  const byUnit = new Map<string, { unit_number: string | null; account: string | null; names: string[]; email: string | null }>()
  for (const o of ownerRows ?? []) {
    const unit = (o.unit_number as string | null)?.trim() || null
    const acct = (o.account_number as string | null)?.trim() || null
    const key = unit ? `u:${unit}` : acct ? `a:${acct}` : null
    if (!key) continue
    let g = byUnit.get(key)
    if (!g) { g = { unit_number: unit, account: null, names: [], email: null }; byUnit.set(key, g) }
    if (!g.account && acct) g.account = acct
    const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
    if (name && !g.names.includes(name)) g.names.push(name)
    if (!g.email) g.email = firstEmail(o.emails as string | null)
  }

  const occBy = new Map((occRows ?? []).map(r => [r.unit_ref as string, r.status as Occupancy]))
  const onFileBy = new Map<string, Set<string>>()
  for (const r of recRows ?? []) {
    if (r.status === 'missing' || r.status === 'na') continue
    const s = onFileBy.get(r.unit_ref as string) ?? new Set<string>(); s.add(r.item_key as string); onFileBy.set(r.unit_ref as string, s)
  }
  const reqBy = new Map((reqRows ?? []).map(r => [r.unit_ref as string, r]))

  const units = [...byUnit.values()].map(g => ({ ref: g.account ?? g.unit_number ?? '', unit_number: g.unit_number, names: g.names, email: g.email }))
  const uploadedByList = units.flatMap(u => [`owner:${u.ref}`, `tenant:${u.ref}`])
  const { data: docRows } = uploadedByList.length
    ? await supabaseAdmin.from('document_intake').select('id, filename, status, uploaded_by').in('uploaded_by', uploadedByList).neq('status', 'dismissed')
    : { data: [] as { id: string; filename: string | null; status: string; uploaded_by: string | null }[] }
  const docsBy = new Map<string, { id: string; filename: string | null; status: string }[]>()
  for (const d of docRows ?? []) {
    const ref = String(d.uploaded_by ?? '').replace(/^(owner|tenant):/, '')
    const arr = docsBy.get(ref) ?? []; arr.push({ id: d.id as string, filename: d.filename as string | null, status: d.status as string }); docsBy.set(ref, arr)
  }

  const rows = units.map(u => {
    const occ = occBy.get(u.ref) ?? null
    const onFile = onFileBy.get(u.ref) ?? new Set<string>()
    const missing = requiredItemKeys(kind, occ).filter(k => !onFile.has(k)).length
    const req = reqBy.get(u.ref)
    const received = docsBy.get(u.ref) ?? []
    const status = received.length ? 'received' : req?.opened_at ? 'clicked' : req?.last_sent_at ? 'sent' : 'not_sent'
    return {
      unit_ref: u.ref, label: `${u.unit_number ? `Unit ${u.unit_number}` : u.ref} · ${u.names[0] ?? 'Owner'}${u.names.length > 1 ? ` +${u.names.length - 1}` : ''}`,
      email: u.email, missing, status,
      sentAt: req?.last_sent_at ?? null, sendCount: req?.send_count ?? 0, openedAt: req?.opened_at ?? null, received,
    }
  }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  return NextResponse.json({ assoc, name: assocRow?.association_name ?? assoc, kind, rows })
}
