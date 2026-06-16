// =====================================================================
// POST /api/vendor/onboard/[token]   (onboarding-token-gated; no session)
// multipart: category = 'coi' | 'license', file = <PDF/image>
// MAIA reads the doc and applies it to the CINC vendor (COI → insurance
// file; license → vendor license), updating the onboarding status.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyVendorOnboardingToken } from '@/lib/vendor-onboarding-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { extractVendorDocument } from '@/lib/vendor-doc-extraction'
import { applyCoiToCinc, applyLicenseToCinc, storeVendorDoc } from '@/lib/vendor-doc-apply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX = 10 * 1024 * 1024  // CINC insurance byte-array cap is 10 MB
const ACCEPT = /\.(pdf|jpe?g|png|heic|heif|webp)$/i

export async function POST(req: Request, c: { params: Promise<{ token: string }> }) {
  const id = await verifyVendorOnboardingToken((await c.params).token)
  if (!id) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })
  const { data: row } = await supabaseAdmin.from('vendor_onboarding').select('id, cinc_vendor_id, docs').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'onboarding not found' }, { status: 404 })
  const vendorId = row.cinc_vendor_id as number | null
  if (!vendorId) return NextResponse.json({ error: 'No CINC vendor linked.' }, { status: 409 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 }) }
  const category = String(form.get('category') ?? '').toLowerCase()
  if (category !== 'coi' && category !== 'license') return NextResponse.json({ error: 'category must be coi or license' }, { status: 400 })
  const file = form.getAll('file').find((f): f is File => f instanceof File && f.size > 0)
  if (!file) return NextResponse.json({ error: 'no file uploaded' }, { status: 400 })
  if (file.size > MAX) return NextResponse.json({ error: 'file is over 10 MB — please upload a smaller copy' }, { status: 400 })
  if (!ACCEPT.test(file.name)) return NextResponse.json({ error: 'not a PDF or image' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const path = await storeVendorDoc(id, buf, file.name, file.type || 'application/pdf')
  const extracted = await extractVendorDocument(buf, file.name, file.type || null, { mask: true }).catch(() => null)
  const f = extracted?.fields ?? {}
  const docs = (row.docs as Record<string, unknown>) ?? {}

  try {
    if (category === 'coi') {
      await applyCoiToCinc(vendorId, buf.toString('base64'), file.name, {
        carrier: f.carrier ?? null, policyNumber: f.policy_number ?? null, expiration: f.expiration_date ?? null,
      })
      await supabaseAdmin.from('vendor_onboarding').update({
        coi_status: 'applied',
        docs: { ...docs, coi: { storage_path: path, carrier: f.carrier ?? null, expiration: f.expiration_date ?? null, at: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq('id', id)
    } else {
      await applyLicenseToCinc(vendorId, {
        licenseNumber: f.license_number ?? null, expiration: f.expiration_date ?? null, description: f.license_type ?? f.license_name ?? null,
      })
      await supabaseAdmin.from('vendor_onboarding').update({
        license_status: 'applied',
        docs: { ...docs, license: { storage_path: path, number: f.license_number ?? null, expiration: f.expiration_date ?? null, at: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq('id', id)
    }
  } catch (e) {
    return NextResponse.json({ error: `Couldn't save your ${category.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, category })
}
