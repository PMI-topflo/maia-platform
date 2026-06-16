// =====================================================================
// /api/vendor/onboard/[token]/ach   (onboarding-token-gated; no session)
// Mirrors /api/vendor/upload/[token]/ach so AchSection reuses it. The
// banking authorization is CAPTURED (status 'received') but NOT written to
// CINC here — a staffer confirms it first (fraud control). The signed PDF
// is stored so staff can re-verify the full numbers at confirm time.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyVendorOnboardingToken } from '@/lib/vendor-onboarding-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCincVendorDetail } from '@/lib/integrations/cinc'
import { lookupBankName, isValidRoutingNumber } from '@/lib/bank-routing'
import { buildAchAuthorizationPdf } from '@/lib/vendor-ach-authorization'
import { storeVendorDoc } from '@/lib/vendor-doc-apply'

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
  const routing = detail?.Routing ?? null, account = detail?.Account ?? null
  const onFile = !!(routing && account)
  return NextResponse.json({
    hasVendor: true, vendorName: detail?.VendorName ?? cx.vendorName, onFile,
    bankName: onFile ? await lookupBankName(routing!) : null,
    routing: onFile ? routing : null, accountLast4: onFile ? last4(account) : null,
    accountType: detail?.AccountType === 1 ? 'savings' : detail?.AccountType === 0 ? 'checking' : null,
  })
}

export async function POST(req: Request, c: { params: Promise<{ token: string }> }) {
  const cx = await ctx((await c.params).token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  if (String(body.action ?? '') === 'confirm') {
    await supabaseAdmin.from('vendor_onboarding').update({ ach_status: 'received', updated_at: new Date().toISOString() }).eq('id', cx.id)
    return NextResponse.json({ ok: true, confirmed: true })
  }
  if (String(body.action) !== 'update') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  const routing = String(body.routing ?? '').replace(/\D/g, '')
  const account = String(body.account ?? '').replace(/\D/g, '')
  const accountType = body.accountType === 'savings' ? 'savings' : 'checking'
  const authorizedName = String(body.authorizedName ?? '').trim()
  const authorizedTitle = String(body.authorizedTitle ?? '').trim()
  if (!isValidRoutingNumber(routing)) return NextResponse.json({ error: 'Enter a valid 9-digit routing number.' }, { status: 400 })
  if (account.length < 4 || account.length > 17) return NextResponse.json({ error: 'Enter a valid account number.' }, { status: 400 })
  if (!authorizedName || !authorizedTitle) return NextResponse.json({ error: 'Your name and title are required.' }, { status: 400 })
  if (body.certify !== true) return NextResponse.json({ error: 'You must confirm you are responsible for the information.' }, { status: 400 })

  const today = new Date().toISOString().slice(0, 10)
  const bankName = (typeof body.bankName === 'string' && body.bankName.trim()) ? body.bankName.trim() : await lookupBankName(routing)
  const pdf = await buildAchAuthorizationPdf({ vendorName: cx.vendorName ?? 'Vendor', woLabel: `Onboarding · ${cx.vendorName ?? ''}`, bankName, routing, account, accountType, authorizedName, authorizedTitle, date: today, submissionNote: `Authorized by ${authorizedName}, ${authorizedTitle}.` })
  const path = await storeVendorDoc(cx.id, pdf, `ACH Authorization — ${(cx.vendorName ?? 'vendor').slice(0, 40)} — ${today}.pdf`)

  // Captured, not applied — staff confirm writes it to CINC.
  await supabaseAdmin.from('vendor_onboarding').update({
    ach_status: 'received',
    docs: { ...cx.docs, ach: { storage_path: path, bank_name: bankName, routing_last4: routing.slice(-4), account_last4: account.slice(-4), account_type: accountType, authorized_name: authorizedName, at: new Date().toISOString() } },
    updated_at: new Date().toISOString(),
  }).eq('id', cx.id).then(() => null, () => null)
  return NextResponse.json({ ok: true, updated: true })
}
