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
import { listVendorsForAssociation, getVendorComplianceStatus } from '@/lib/integrations/cinc'

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

  const all = await listVendorsForAssociation(assoc).catch(() => [])
  const vendors = all.slice(0, MAX_VENDORS)

  const rows = await Promise.all(vendors.map(async v => {
    const c = await getVendorComplianceStatus(v.VendorId, assoc).catch(() => null)
    return {
      id:      v.VendorId,
      name:    v.VendorName,
      coi:     c ? dated(c.coi.onFile, c.coi.valid, c.coi.expiration) : ('none' as Rag),
      w9:      (c?.w9.onFile ? 'ok' : 'none') as Rag,
      ach:     (c?.ach.onFile ? 'ok' : 'none') as Rag,
      license: c ? dated(c.license.onFile, c.license.valid, c.license.expiration) : ('none' as Rag),
    }
  }))

  return NextResponse.json({ vendors: rows, truncated: all.length > vendors.length })
}
