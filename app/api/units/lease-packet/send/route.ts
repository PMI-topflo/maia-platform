// POST /api/units/lease-packet/send  { account, assoc }
// Create a lease packet for a leased unit and email the owner AND the tenant
// their login-free e-signature links for the Landlord–Tenant Agreement.
// Triggered from the unit page (staff / board / manager). Snapshots the
// owner, tenant, lease term, and the association's legal name so the same
// flow serves any association.

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { signLeasePacketToken, type LeasePacketRole } from '@/lib/lease-packet-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const firstEmail = (e: string | null) => (e ?? '').split(/[,;\s]+/).map(s => s.trim()).find(x => x.includes('@')) ?? null
const firstNonEmpty = (...vals: (string | null | undefined)[]) => vals.map(v => (v ?? '').trim()).find(Boolean) ?? null

/** Compose a single-line unit mailing address from the association's principal
 *  street address + the unit number + city/state/zip. Any missing part is
 *  skipped; returns null when there's nothing to show. */
function composeAddress(a: { street: string | null; unit: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const street = (a.street ?? '').trim()
  const unit = (a.unit ?? '').trim()
  // "123 Main St, Unit 511" — only add "Unit N" when it isn't already in the street line.
  const line1 = [street, unit && !new RegExp(`\\b(unit|apt|#)\\s*${unit}\\b`, 'i').test(street) ? `Unit ${unit}` : '']
    .filter(Boolean).join(', ')
  const cityState = [(a.city ?? '').trim(), [(a.state ?? '').trim(), (a.zip ?? '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const full = [line1, cityState].filter(Boolean).join(', ')
  return full.trim() ? full : null
}

function inviteHtml(role: LeasePacketRole, opts: { name: string | null; legal: string; unit: string; link: string }): { subject: string; html: string } {
  const who = role === 'owner' ? 'Unit Owner / Landlord' : 'Tenant'
  const subject = `Please e-sign the Landlord–Tenant Agreement — Unit ${opts.unit}`
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hello${opts.name ? ` ${esc(opts.name)}` : ''},</p>
    <p>${esc(opts.legal)} requires the Landlord–Tenant Acknowledgment &amp; Agreement to be signed for <strong>Unit ${esc(opts.unit)}</strong>. You are signing as the <strong>${who}</strong>.</p>
    <p>Please review the full document and sign electronically — it only takes a minute:</p>
    <p style="margin:22px 0"><a href="${opts.link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Review &amp; e-sign →</a></p>
    <p style="color:#6b7280;font-size:12px">No account needed. This link is specific to you.</p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
  return { subject, html }
}

export async function POST(req: Request) {
  let body: { account?: string; assoc?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const auth = await resolveUnitsAuth(body.assoc ?? null)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const account = String(body.account ?? '').trim()
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [{ data: owner }, { data: tenant }, { data: assoc }] = await Promise.all([
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails, phone, phone_e164, unit_number')
      .eq('association_code', auth.assoc).eq('account_number', account).or('status.neq.previous,status.is.null').maybeSingle(),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_name, tenant_email, tenant_phone, lease_start, lease_end')
      .eq('association_code', auth.assoc).eq('unit_ref', account).maybeSingle(),
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', auth.assoc).maybeSingle(),
  ])

  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || auth.assoc
  const ownerName = (owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ').trim() || null
  const ownerEmail = firstEmail((owner?.emails as string | null) ?? null)
  const ownerMobile = firstNonEmpty((owner?.phone as string | null), (owner?.phone_e164 as string | null))
  const tenantName = (tenant?.tenant_name as string | null) ?? null
  const tenantEmail = firstEmail((tenant?.tenant_email as string | null) ?? null)
  const tenantMobile = firstNonEmpty((tenant?.tenant_phone as string | null))
  const unitLabel = (owner?.unit_number as string | null) || account
  // Snapshot the unit's mailing address: association principal street + unit
  // number + city/state/zip. Composed here (not stored elsewhere); staff verify
  // it against the lease/approval later per the field-wiring plan.
  const propertyAddress = composeAddress({
    street: (assoc?.principal_address as string | null) ?? null, unit: unitLabel,
    city: (assoc?.city as string | null) ?? null, state: (assoc?.state as string | null) ?? null, zip: (assoc?.zip as string | null) ?? null,
  })

  if (!ownerEmail && !tenantEmail) return NextResponse.json({ error: 'No owner or tenant email on file — add one first.' }, { status: 400 })

  const { data: created, error } = await supabaseAdmin.from('lease_packets').insert({
    association_code: auth.assoc, unit_ref: account, unit_number: unitLabel,
    association_legal_name: legal, owner_name: ownerName, owner_email: ownerEmail, owner_mobile: ownerMobile,
    tenant_name: tenantName, tenant_email: tenantEmail, tenant_mobile: tenantMobile,
    property_address: propertyAddress,
    lease_start: (tenant?.lease_start as string | null) ?? null, lease_end: (tenant?.lease_end as string | null) ?? null,
    effective_date: new Date().toISOString().slice(0, 10), status: 'sent', created_by: `${auth.persona}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create packet: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const sent: string[] = [], skipped: string[] = []
  for (const [role, name, email] of [['owner', ownerName, ownerEmail], ['tenant', tenantName, tenantEmail]] as [LeasePacketRole, string | null, string | null][]) {
    if (!email) { skipped.push(`${role} (no email)`); continue }
    const link = `${APP}/lease-packet/${await signLeasePacketToken(created.id, role)}`
    const { subject, html } = inviteHtml(role, { name, legal, unit: unitLabel, link })
    try { await sendEmail({ to: email, subject, html }); sent.push(`${role} → ${email}`) }
    catch (e) { skipped.push(`${role} (send failed: ${e instanceof Error ? e.message : 'error'})`) }
  }

  return NextResponse.json({ ok: true, packetId: created.id, sent, skipped })
}
