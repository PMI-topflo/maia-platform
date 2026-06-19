// =====================================================================
// GET /api/admin/cinc/association-vendors?assoc=CODE
//
// Vendors serving an association + their CINC compliance (COI / W-9 / ACH
// / license) as RAG states. Lazy-loaded by the Association Hub's Vendors
// tab — it's N×3 CINC calls (detail + insurance + license per vendor), so
// we only run it when the tab is opened, capped to keep it bounded.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listVendorsForAssociation, getVendorComplianceStatus, listVendorsFull } from '@/lib/integrations/cinc'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_VENDORS = 30
const SOON_MS = 30 * 24 * 60 * 60 * 1000  // COI/license "expiring soon" window

type Rag = 'ok' | 'warn' | 'bad' | 'none'

function dated(onFile: boolean, valid: boolean | null, expiration: string | null): Rag {
  if (!onFile) return 'none'
  if (valid === false) return 'bad'
  if (expiration && new Date(expiration).getTime() - Date.now() < SOON_MS) return 'warn'
  return 'ok'
}

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const assoc = (new URL(req.url).searchParams.get('assoc') ?? '').trim().toUpperCase()
  if (!assoc) return NextResponse.json({ error: 'assoc is required' }, { status: 400 })

  // Two link sources: CINC's vendor-association accounts (read-only, sparse)
  // and MAIA-local tags (what staff add here, since CINC has no write API).
  const [cincVendors, links, full] = await Promise.all([
    listVendorsForAssociation(assoc).catch(() => []),
    supabaseAdmin.from('association_vendor_links').select('cinc_vendor_id, vendor_name').eq('association_code', assoc),
    listVendorsFull().catch(() => []),
  ])
  const cincIds = new Set(cincVendors.map(v => v.VendorId))
  const byId = new Map(full.map(v => [v.VendorId, v]))

  // MAIA-tagged vendors that CINC doesn't already list — enrich the name from
  // the full catalog (falling back to the stored name) so they render properly.
  const maiaOnly = (links.data ?? [])
    .map(l => Number(l.cinc_vendor_id))
    .filter(id => Number.isFinite(id) && id > 0 && !cincIds.has(id))
    .map(id => ({ VendorId: id, VendorName: byId.get(id)?.VendorName ?? (links.data ?? []).find(l => Number(l.cinc_vendor_id) === id)?.vendor_name ?? `Vendor #${id}` }))

  const maiaIds = new Set((links.data ?? []).map(l => Number(l.cinc_vendor_id)))
  const vendors = [...cincVendors, ...maiaOnly].slice(0, MAX_VENDORS + maiaOnly.length)

  // Trade/type per vendor — CINC carries it as VendorType on the full
  // catalog (cached 1h), keyed by VendorId. Names-only assoc list lacks it.
  // A MAIA-local override (assigned type or a trade CINC lacks) wins.
  const tradeById = new Map<number, string>()
  for (const v of full) if (v.VendorType && v.VendorType.trim()) tradeById.set(v.VendorId, v.VendorType.trim())

  const ids = vendors.map(v => v.VendorId)
  const { data: overrides } = await supabaseAdmin.from('vendor_trade_overrides').select('vendor_id, trade, source').in('vendor_id', ids.length ? ids : [-1])
  const overrideById = new Map<number, { trade: string; source: string }>()
  for (const o of overrides ?? []) overrideById.set(Number(o.vendor_id), { trade: String(o.trade), source: String(o.source) })

  const rows = await Promise.all(vendors.map(async v => {
    const c = await getVendorComplianceStatus(v.VendorId, assoc).catch(() => null)
    const ov = overrideById.get(v.VendorId)
    const trade = ov?.trade ?? tradeById.get(v.VendorId) ?? null
    return {
      id:          v.VendorId,
      name:        v.VendorName,
      trade,
      tradeSource: ov?.source ?? (tradeById.get(v.VendorId) ? 'cinc' : null),
      // How this vendor is linked to the association: a CINC vendor-association
      // account, or a MAIA-local tag (the only kind staff can add/remove).
      linked:  cincIds.has(v.VendorId) ? ('cinc' as const) : maiaIds.has(v.VendorId) ? ('maia' as const) : null,
      coi:     c ? dated(c.coi.onFile, c.coi.valid, c.coi.expiration) : ('none' as Rag),
      w9:      (c?.w9.onFile ? 'ok' : 'none') as Rag,
      ach:     (c?.ach.onFile ? 'ok' : 'none') as Rag,
      license: c ? dated(c.license.onFile, c.license.valid, c.license.expiration) : ('none' as Rag),
    }
  }))

  return NextResponse.json({ vendors: rows, truncated: cincVendors.length > MAX_VENDORS })
}
