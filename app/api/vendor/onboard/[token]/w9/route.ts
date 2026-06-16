// =====================================================================
// /api/vendor/onboard/[token]/w9   (onboarding-token-gated; no session)
// Mirrors /api/vendor/upload/[token]/w9 so W9Section reuses it, but resolves
// the CINC vendor from the onboarding row and APPLIES the W-9 immediately
// (low fraud risk; ACH is the gated one).
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyVendorOnboardingToken } from '@/lib/vendor-onboarding-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCincVendorDetail } from '@/lib/integrations/cinc'
import { buildW9RecordPdf, TAX_CLASSIFICATION_LABELS, type TaxClassification } from '@/lib/vendor-w9-record'
import { applyW9ToCinc, storeVendorDoc } from '@/lib/vendor-doc-apply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const last4 = (s: string | null | undefined) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : null }

async function ctx(token: string) {
  const id = await verifyVendorOnboardingToken(token)
  if (!id) return null
  const { data } = await supabaseAdmin.from('vendor_onboarding').select('id, cinc_vendor_id, company_name, docs').eq('id', id).maybeSingle()
  return data ? { id: data.id as string, vendorId: (data.cinc_vendor_id as number | null) ?? null, vendorName: (data.company_name as string | null) ?? null, docs: (data.docs as Record<string, unknown>) ?? {} } : null
}

export async function GET(_req: Request, c: { params: Promise<{ token: string }> }) {
  const cx = await ctx((await c.params).token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })
  if (!cx.vendorId) return NextResponse.json({ hasVendor: false, onFile: false, vendorName: cx.vendorName })
  const detail = await getCincVendorDetail(cx.vendorId).catch(() => null)
  const onFile = !!(detail?.TaxID && String(detail.TaxID).trim())
  return NextResponse.json({ hasVendor: true, vendorName: detail?.VendorName ?? cx.vendorName, onFile, checkName: detail?.CheckName ?? null, taxIdLast4: onFile ? last4(detail?.TaxID) : null })
}

export async function POST(req: Request, c: { params: Promise<{ token: string }> }) {
  const cx = await ctx((await c.params).token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })
  if (!cx.vendorId) return NextResponse.json({ error: 'No CINC vendor linked.' }, { status: 409 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (String(body.action ?? '') === 'confirm') {
    await supabaseAdmin.from('vendor_onboarding').update({ w9_status: 'applied', updated_at: new Date().toISOString() }).eq('id', cx.id)
    return NextResponse.json({ ok: true, confirmed: true })
  }
  if (String(body.action) !== 'update') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const legalName = String(body.legalName ?? '').trim()
  const businessName = String(body.businessName ?? '').trim() || null
  const classification = String(body.classification ?? '') as TaxClassification
  const tinType = body.tinType === 'ssn' ? 'ssn' : 'ein'
  const tin = String(body.tin ?? '').replace(/\D/g, '')
  const authorizedName = String(body.authorizedName ?? '').trim()
  const authorizedTitle = String(body.authorizedTitle ?? '').trim()
  if (!legalName) return NextResponse.json({ error: 'Your legal name is required.' }, { status: 400 })
  if (!(classification in TAX_CLASSIFICATION_LABELS)) return NextResponse.json({ error: 'Select a federal tax classification.' }, { status: 400 })
  if (tin.length !== 9) return NextResponse.json({ error: `Enter a valid 9-digit ${tinType === 'ssn' ? 'SSN' : 'EIN'}.` }, { status: 400 })
  if (!authorizedName || !authorizedTitle) return NextResponse.json({ error: 'Your name and title are required.' }, { status: 400 })
  if (body.certify !== true) return NextResponse.json({ error: 'You must certify the information.' }, { status: 400 })

  const today = new Date().toISOString().slice(0, 10)
  const pdf = await buildW9RecordPdf({ vendorName: cx.vendorName ?? 'Vendor', woLabel: `Onboarding · ${cx.vendorName ?? ''}`, legalName, businessName, classification, tinType, tin, authorizedName, authorizedTitle, date: today })
  const path = await storeVendorDoc(cx.id, pdf, `Substitute W-9 — ${(legalName || 'vendor').slice(0, 40)} — ${today}.pdf`)
  try {
    await applyW9ToCinc(cx.vendorId, { legalName, businessName, tin })
  } catch (e) {
    return NextResponse.json({ error: `Couldn't save your W-9: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  await supabaseAdmin.from('vendor_onboarding').update({
    w9_status: 'applied',
    docs: { ...cx.docs, w9: { storage_path: path, tin_last4: tin.slice(-4), classification, authorized_name: authorizedName, at: new Date().toISOString() } },
    updated_at: new Date().toISOString(),
  }).eq('id', cx.id).then(() => null, () => null)
  return NextResponse.json({ ok: true, updated: true })
}
