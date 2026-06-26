// =====================================================================
// POST /api/admin/vendors/onboard   (staff-only)
//
// action:'check'  { name, dba?, email?, phone?, address1?, city?, zip? }
//   → likely-duplicate CINC vendors (search name/dba/email/phone/address)
//     so Paola doesn't create a duplicate.
// action:'create' { ...basics, vendorTypeId?, licenseRequired }
//   → create the vendor in CINC immediately, start a vendor_onboarding
//     row, return the standalone onboarding link.
// action:'link'   { cincVendorId, ...basics, licenseRequired }
//   → don't create; start an onboarding row against an EXISTING CINC vendor
//     (gap-fill its missing docs).
// Optional `email` on create/link → also emails the vendor the link, cc Paola.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createVendor } from '@/lib/integrations/cinc'
import { findVendorDuplicates, searchVendors } from '@/lib/vendor-dedupe'
import { signVendorOnboardingToken } from '@/lib/vendor-onboarding-token'
import { sendEmail } from '@/lib/gmail'
import { VENDOR_NOTIFY_CC, VENDOR_REPLY_TO } from '@/lib/notify-recipients'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function staff() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return typeof session.userId === 'string' ? session.userId : 'staff'
}

export async function POST(req: Request) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const action = String(b.action ?? '')
  const str = (k: string) => { const v = b[k]; return typeof v === 'string' && v.trim() ? v.trim() : null }
  const name = str('name')

  // ── Live free-text search across ALL CINC vendors (find-before-create) ──
  if (action === 'search') {
    const q = typeof b.q === 'string' ? b.q : ''
    return NextResponse.json({ matches: await searchVendors(q) })
  }

  // ── Duplicate check ──────────────────────────────────────────────
  if (action === 'check') {
    if (!name) return NextResponse.json({ matches: [] })
    const matches = await findVendorDuplicates({
      name, dba: str('dba'), email: str('email'), phone: str('phone'), address1: str('address1'), city: str('city'), zip: str('zip'),
    })
    return NextResponse.json({ matches })
  }

  if (action !== 'create' && action !== 'link') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const licenseRequired = b.licenseRequired === true
  let cincVendorId: number

  if (action === 'create') {
    if (!name) return NextResponse.json({ error: 'Company name is required.' }, { status: 400 })
    try {
      const r = await createVendor({
        name, email: str('email'), phone: str('phone'), address1: str('address1'),
        city: str('city'), state: str('state'), zip: str('zip'), vendorTypeId: str('vendorTypeId'),
      })
      cincVendorId = r.vendorId
    } catch (e) {
      return NextResponse.json({ error: `CINC create failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
  } else {
    const id = Number(b.cincVendorId)
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'cincVendorId required to link.' }, { status: 400 })
    cincVendorId = id
  }

  // Onboarding tracking row. license_status starts 'pending' only when required.
  const { data: row, error } = await supabaseAdmin.from('vendor_onboarding').insert({
    cinc_vendor_id:   cincVendorId,
    company_name:     name ?? `Vendor ${cincVendorId}`,
    email:            str('email'),
    phone:            str('phone'),
    address1:         str('address1'),
    city:             str('city'),
    state:            str('state'),
    zip:              str('zip'),
    vendor_type_id:   str('vendorTypeId'),
    vendor_type_name: str('vendorTypeName'),
    license_required: licenseRequired,
    license_status:   licenseRequired ? 'pending' : 'na',
    created_by:       me,
  }).select('id').single()

  if (error || !row) {
    // CINC vendor may have been created — surface the id so it's not lost.
    return NextResponse.json({ error: `Vendor ${action === 'create' ? `created in CINC (VendorId ${cincVendorId}) but ` : ''}onboarding record failed: ${error?.message ?? 'insert error'}`, cincVendorId }, { status: 502 })
  }

  const tok = await signVendorOnboardingToken(row.id as string)
  const link = `${APP}/vendor/onboard/${tok}`

  // Optionally email the vendor the link (cc Paola so she can follow up).
  const to = str('email')
  let emailed = false
  if (to) {
    const subject = 'Welcome — a few documents to get you set up · PMI Top Florida Properties'
    const text = `Hello${name ? ` ${name}` : ''},\n\nWelcome! To get you set up for payment, please provide a few documents through this secure link — no account needed:\n${link}\n\nYou can fill in your W-9 and banking (ACH) right in the form, and upload your insurance (COI)${licenseRequired ? ' and license' : ''}.\n\nThank you,\nPMI Top Florida Properties`
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c)).replace(/\n/g, '<br>')}</div>`
    await sendEmail({ to, bcc: VENDOR_NOTIFY_CC, replyTo: VENDOR_REPLY_TO, subject, html, text }).then(() => { emailed = true }, () => null)
  }

  return NextResponse.json({ ok: true, onboardingId: row.id, cincVendorId, link, emailed })
}
