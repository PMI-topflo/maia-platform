// =====================================================================
// POST /api/owner/ach/[token]
//
// Owner submits the online ACH/autopay form → MAIA writes it straight into
// CINC (Billing Type = Automatic ACH + routing/account/type + start date),
// stores the signed authorization for the audit trail (last-4 only; full bank
// numbers go to CINC and are never stored), and emails Jonathan + Karen.
// The token (HMAC) authorizes the owner — minted only after the OTP-verified
// WhatsApp/SMS flow. GET serves the owner's display info to pre-fill the form.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyAchToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listAssociationProperties, setHomeownerAch } from '@/lib/integrations/cinc'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const JONATHAN = process.env.MAIA_AR_EMAIL ?? 'ar@topfloridaproperties.com'
const KAREN    = process.env.MAIA_BILLING_ALERT_TO ?? 'billing@topfloridaproperties.com'
const last4 = (s: string) => s.replace(/\D/g, '').slice(-4)

async function ownerInfo(assoc: string, account: string) {
  const { data } = await supabaseAdmin.from('owners')
    .select('first_name, last_name, entity_name, unit_number, address, association_name')
    .eq('association_code', assoc).eq('account_number', account).limit(1).maybeSingle()
  const name = (data?.entity_name as string) || [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() || 'Owner'
  return { name, unit: (data?.unit_number as string) ?? null, address: (data?.address as string) ?? null, association: (data?.association_name as string) ?? assoc }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyAchToken(token)
  if (!data) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })
  const o = await ownerInfo(data.assoc, data.account)
  return NextResponse.json({ ok: true, ...o, account: data.account, association_code: data.assoc })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const data = await verifyAchToken(token)
  if (!data) return NextResponse.json({ error: 'This link has expired or is invalid.' }, { status: 401 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '')
  const bankName       = str('bankName')
  const accountOwner   = str('accountOwnerName')
  const routing        = str('routing').replace(/\D/g, '')
  const account        = str('account').replace(/\D/g, '')
  const accountTypeRaw = str('accountType').toLowerCase()   // 'checking' | 'savings'
  const signature      = str('signature')
  const authorized     = b.authorized === true

  if (!authorized) return NextResponse.json({ error: 'You must authorize the automatic payments.' }, { status: 400 })
  if (!signature)  return NextResponse.json({ error: 'A typed signature is required.' }, { status: 400 })
  if (routing.length !== 9) return NextResponse.json({ error: 'Routing number must be 9 digits.' }, { status: 400 })
  if (account.length < 4)   return NextResponse.json({ error: 'Please enter a valid account number.' }, { status: 400 })
  if (accountTypeRaw !== 'checking' && accountTypeRaw !== 'savings') return NextResponse.json({ error: 'Choose checking or savings.' }, { status: 400 })

  // Resolve the CINC PropertyID + the owner-address row for this account.
  const props = await listAssociationProperties(data.assoc).catch(() => [])
  const prop  = props.find(p => String(p.PropertyHOID ?? '').toUpperCase() === data.account.toUpperCase())
  const addr  = prop?.Address?.find(a => a.OwnerAddress) ?? prop?.Address?.[0]
  if (!prop || !addr) return NextResponse.json({ error: 'Could not locate your unit in CINC — our team will follow up.' }, { status: 502 })

  const o = await ownerInfo(data.assoc, data.account)
  const accountType = accountTypeRaw === 'savings' ? 2 : 1
  const today = new Date().toISOString().slice(0, 10)

  // Write to CINC (best-effort; capture the response for the audit).
  let cincResponse: unknown = null, cincWritten = false
  try {
    cincResponse = await setHomeownerAch({
      propertyAddressId: addr.PropertyAddressId as number,
      propertyId:        prop.PropertyID,
      billingTypeId:     3,           // Automatic ACH
      routing, account, accountType,
      achStartDate:      today,
    })
    cincWritten = true
  } catch (e) {
    cincResponse = { error: e instanceof Error ? e.message : String(e) }
  }

  // Audit (last-4 only; full numbers live in CINC, never here).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  try {
    await supabaseAdmin.from('owner_ach_submissions').insert({
      association_code: data.assoc, account_number: data.account, property_id: prop.PropertyID,
      owner_name: o.name, bank_name: bankName, account_owner_name: accountOwner, account_type: accountTypeRaw,
      routing_last4: last4(routing), account_last4: last4(account),
      signature, authorized, signed_ip: ip, signed_user_agent: req.headers.get('user-agent'),
      cinc_written: cincWritten, cinc_response: cincResponse,
    })
  } catch { /* audit best-effort */ }

  // Notify Jonathan (AR) + Karen (billing) to spot-check.
  void sendEmail({
    to: [JONATHAN, KAREN],
    subject: `ACH autopay set up — ${o.name} (${data.assoc} ${data.account})${cincWritten ? '' : ' — CINC WRITE FAILED'}`,
    html: `<p>${o.name} (Unit ${o.unit ?? '—'}, ${o.association}, account ${data.account}, CINC PropertyID ${prop.PropertyID}) set up automatic ACH payments online.</p>
      <table style="font-size:13px;border-collapse:collapse">
        <tr><td style="padding:4px 10px;color:#6b7280">Bank</td><td style="padding:4px 10px">${bankName || '—'}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Account owner</td><td style="padding:4px 10px">${accountOwner || '—'}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Type</td><td style="padding:4px 10px">${accountTypeRaw}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Routing</td><td style="padding:4px 10px">•••${last4(routing)}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Account</td><td style="padding:4px 10px">•••${last4(account)}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Signature</td><td style="padding:4px 10px">${signature}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">CINC write</td><td style="padding:4px 10px">${cincWritten ? '✅ written (verify in CINC)' : '❌ FAILED — set up manually'}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px">Full routing/account were written to CINC and are not stored in MAIA.</p>`,
  }).catch(() => null)

  return NextResponse.json({ ok: true, cincWritten })
}
