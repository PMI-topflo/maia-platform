// =====================================================================
// POST /api/admin/vendors/onboarding/[id]/confirm-ach   (staff-only)
//
// The fraud-control step: a staffer confirms the banking the vendor
// submitted during onboarding, which writes it to CINC. The full
// routing/account live only inside the stored ACH PDF — re-extracted here
// (server-side, transient) and applied via applyAchToCinc. Sets ach_status
// 'applied'.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { extractVendorDocument } from '@/lib/vendor-doc-extraction'
import { applyAchToCinc, getVendorDoc } from '@/lib/vendor-doc-apply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = (await ctx.params).id
  const { data: row } = await supabaseAdmin.from('vendor_onboarding')
    .select('id, cinc_vendor_id, ach_status, docs').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'onboarding not found' }, { status: 404 })
  if (!row.cinc_vendor_id) return NextResponse.json({ error: 'No CINC vendor linked.' }, { status: 409 })
  if (row.ach_status !== 'received') return NextResponse.json({ error: `Nothing to confirm — ACH status is "${row.ach_status}".` }, { status: 400 })

  const ach = (row.docs as Record<string, { storage_path?: string } > | null)?.ach
  if (!ach?.storage_path) return NextResponse.json({ error: 'The vendor has not submitted banking yet.' }, { status: 400 })

  const buf = await getVendorDoc(ach.storage_path)
  if (!buf) return NextResponse.json({ error: 'Could not read the stored authorization.' }, { status: 502 })

  // Re-extract FULL values from the PDF (transient — never persisted).
  const ext = await extractVendorDocument(buf, 'ach.pdf', 'application/pdf', { mask: false }).catch(() => null)
  const f = ext?.fields ?? {}
  const routing = digits(f.routing_last4 ?? f.routing ?? f.routing_number)
  const account = digits(f.account_last4 ?? f.account ?? f.account_number)
  const accountType = String(f.account_type ?? '').toLowerCase().includes('sav') ? 'savings' : 'checking'
  if (routing.length !== 9 || account.length < 4) {
    return NextResponse.json({ error: 'Could not read valid routing/account from the authorization PDF.' }, { status: 502 })
  }

  try {
    await applyAchToCinc(row.cinc_vendor_id as number, { routing, account, accountType })
  } catch (e) {
    return NextResponse.json({ error: `CINC update failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  await supabaseAdmin.from('vendor_onboarding').update({ ach_status: 'applied', updated_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ ok: true })
}
