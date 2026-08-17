// =====================================================================
// /api/owner/compliance/[token]   (token-gated; no session)
// GET  → the owner's unit + info on file (name/emails/phones), occupancy,
//        emergency contact, occupants, ownership-verification appraiser
//        link, and the documents still missing.
// POST → occupancy | commercialUseType | confirmContact | contactChangeRequest
//        | emergencyContact. Returns the recomputed missing list.
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyOwnerComplianceToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUnitComplianceState, setUnitOccupancy, setCommercialUseType, OCCUPANCY_LABEL, type Occupancy } from '@/lib/unit-required-docs'
import { propertyAppraiser } from '@/lib/property-appraiser'
import { signEsignToken } from '@/lib/esign-token'
import { sendEmergencyContactForm } from '@/lib/emergency-contact-campaign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'

async function ownerContext(token: string) {
  const t = await verifyOwnerComplianceToken(token)
  if (!t) return null
  const { data: o } = await supabaseAdmin.from('owners')
    .select('first_name, last_name, entity_name, unit_number, association_name, emails, phone, phone_2')
    .eq('association_code', t.assoc).eq('account_number', t.account).maybeSingle()
  const { data: assocRow } = await supabaseAdmin.from('associations')
    .select('city').eq('association_code', t.assoc).maybeSingle()
  const ownerName = (o?.entity_name as string) || [o?.first_name, o?.last_name].filter(Boolean).join(' ').trim() || null
  const emails = String(o?.emails ?? '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
  const phones = [o?.phone, o?.phone_2].filter(Boolean).map(String)
  return {
    assoc: t.assoc, account: t.account, ownerName,
    unit: (o?.unit_number as string | null) ?? null,
    associationName: (o?.association_name as string | null) ?? t.assoc,
    emails, phones,
    appraiser: propertyAppraiser(assocRow?.city as string | null),
  }
}

/** Mark a compliance item satisfied/current for this unit (optional expiry). */
async function markItem(assoc: string, account: string, itemKey: string, expiryDate?: string | null) {
  await supabaseAdmin.from('compliance_records').upsert(
    { scope: 'unit', association_code: assoc, unit_ref: account, item_key: itemKey, applicable: true, status: 'current', expiry_date: expiryDate ?? null, updated_by: 'owner', updated_at: new Date().toISOString() },
    { onConflict: 'scope,association_code,unit_ref,item_key' },
  ).then(() => null, () => null)
}

/** One year from today, ISO date. */
function inOneYear(): string {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10)
}

/** The unit's Emergency Contact List, as the owner should see it: the signed
 *  document they already have, with a link to read it.
 *
 *  This replaces three loose name/phone/email boxes that collected the same
 *  thing a second time, in a shape nobody signed and nothing filed. The signed
 *  form IS the record; the owner's options here are to read it, or to sign a
 *  fresh one that supersedes it. */
async function emergencyFormFor(assoc: string, account: string) {
  const { data } = await supabaseAdmin.from('esign_documents')
    .select('id, status, signers, created_at')
    .eq('kind', 'emergency_contact_list').eq('association_code', assoc).eq('unit_ref', account)
    .neq('status', 'void').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null

  const signers = (Array.isArray(data.signers) ? data.signers : []) as { role?: string; name?: string | null; signed_at?: string }[]
  const signed = signers.find(sg => sg.signed_at) ?? null
  const role = signers[0]?.role ?? 'resident'
  const tok = await signEsignToken(String(data.id), role)
  return {
    status: String(data.status),
    signedAt: signed?.signed_at ?? null,
    signedBy: signed?.name ?? null,
    createdAt: String(data.created_at),
    // A completed form is read as a PDF; one still outstanding is opened to
    // be finished, so the link differs by state rather than by guesswork.
    pdfUrl: `${APP_URL}/api/esign/${tok}/pdf`,
    signUrl: signed ? null : `${APP_URL}/esign/${tok}`,
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ownerContext(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  // Record the first click; also read what the owner has already provided.
  const { data: reqRow } = await supabaseAdmin.from('owner_compliance_requests')
    .select('id, opened_at, contact_confirmed_at, emergency_contact')
    .eq('association_code', cx.assoc).eq('unit_ref', cx.account).maybeSingle()
  void (async () => {
    if (reqRow) { if (!reqRow.opened_at) await supabaseAdmin.from('owner_compliance_requests').update({ opened_at: new Date().toISOString() }).eq('id', reqRow.id) }
    else await supabaseAdmin.from('owner_compliance_requests').insert({ association_code: cx.assoc, unit_ref: cx.account, opened_at: new Date().toISOString() })
  })().catch(() => null)

  const { data: tenantRow } = await supabaseAdmin.from('unit_tenant_contacts')
    .select('tenant_name, tenant_phone, tenant_email, occupants').eq('association_code', cx.assoc).eq('unit_ref', cx.account).maybeSingle()

  // The OWNER'S unit manager for THIS specific unit (unit_managers — the
  // manager the owner hired for their unit), offered as a one-tap emergency
  // contact. This is NOT the building's on-site manager (building_managers,
  // association staff) — deliberately kept separate to avoid conflating them.
  let unitManager: { name: string; phone: string | null; email: string | null } | null = null
  {
    const { data: ums } = await supabaseAdmin.from('unit_managers')
      .select('first_name, last_name, email, phone, managed_units').eq('association_code', cx.assoc).eq('active', true)
    const forThisUnit = (ums ?? []).find(m => {
      const set = new Set(((m.managed_units as string[] | null) ?? []).map(String))
      return set.has(cx.account) || (cx.unit != null && set.has(String(cx.unit)))
    })
    if (forThisUnit) {
      const name = [forThisUnit.first_name, forThisUnit.last_name].filter(Boolean).join(' ').trim()
      if (name || forThisUnit.phone || forThisUnit.email) unitManager = { name: name || 'Unit manager', phone: (forThisUnit.phone as string | null) ?? null, email: (forThisUnit.email as string | null) ?? null }
    }
  }

  const { occupancy, kind, commercialUseType, missing } = await getUnitComplianceState(cx.assoc, cx.account)
  return NextResponse.json({
    ownerName: cx.ownerName, unit: cx.unit, associationName: cx.associationName,
    emails: cx.emails, phones: cx.phones, appraiser: cx.appraiser,
    contactConfirmedAt: reqRow?.contact_confirmed_at ?? null,
    emergencyContact: reqRow?.emergency_contact ?? null,
    emergencyForm: await emergencyFormFor(cx.assoc, cx.account),
    tenant: tenantRow ? { name: tenantRow.tenant_name, phone: tenantRow.tenant_phone, email: tenantRow.tenant_email } : null,
    occupants: (tenantRow?.occupants as unknown[] | null) ?? [],
    unitManager,
    occupancy, occupancyLabel: occupancy ? OCCUPANCY_LABEL[occupancy] : null, kind, commercialUseType, missing,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cx = await ownerContext(token)
  if (!cx) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let body: { status?: string; commercialUseType?: string; confirmContact?: boolean; contactChangeRequest?: string; emergencyContact?: { name?: string; phone?: string; email?: string }; newEmergencyForm?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Owner confirms their name/email/phone on file are correct → satisfies the
  // "Contact Information" item.
  if (body.confirmContact) {
    await supabaseAdmin.from('owner_compliance_requests').upsert(
      { association_code: cx.assoc, unit_ref: cx.account, contact_confirmed_at: new Date().toISOString() },
      { onConflict: 'association_code,unit_ref' },
    ).then(() => null, () => null)
    await markItem(cx.assoc, cx.account, 'unit.contact')
    const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
    return NextResponse.json({ ok: true, contactConfirmed: true, missing })
  }

  // Owner requests a change to their contact info (staff review; we don't
  // overwrite the CINC-synced owners record automatically).
  if (typeof body.contactChangeRequest === 'string') {
    const note = body.contactChangeRequest.trim()
    if (!note) return NextResponse.json({ error: 'Describe the change.' }, { status: 400 })
    await supabaseAdmin.from('owner_compliance_requests').upsert(
      { association_code: cx.assoc, unit_ref: cx.account, contact_change_request: note.slice(0, 2000) },
      { onConflict: 'association_code,unit_ref' },
    ).then(() => null, () => null)
    return NextResponse.json({ ok: true, changeRequested: true })
  }

  // Start a fresh Emergency Contact List. The owner is on the page, so they get
  // the link straight back rather than an email to a page they are looking at.
  //
  // A new one SUPERSEDES the last: emergencyFormFor reads the newest, and
  // signing files a fresh PDF over the checklist row. Nothing is deleted — the
  // superseded copy stays readable, because a list somebody signed is a record
  // of what they told the Association on that date.
  if (body.newEmergencyForm) {
    const to = cx.emails[0] ?? null
    const { data: assocRow } = await supabaseAdmin.from('associations')
      .select('legal_name, association_name, principal_address, city, state, zip')
      .eq('association_code', cx.assoc).maybeSingle()
    const legalName = (assocRow?.legal_name as string | null) || (assocRow?.association_name as string | null) || cx.assoc
    const propertyAddress = [assocRow?.principal_address, cx.unit ? `Unit ${cx.unit}` : null,
      [assocRow?.city, [assocRow?.state, assocRow?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null

    // A unit with a tenant on file is rented out, so the owner is confirming
    // somebody else's household — the form says so and prefills it.
    const { data: t } = await supabaseAdmin.from('unit_tenant_contacts')
      .select('tenant_name, occupants').eq('association_code', cx.assoc).eq('unit_ref', cx.account).maybeSingle()
    const extra = (Array.isArray(t?.occupants) ? t!.occupants : []) as Array<{ name?: string } | string>
    const occupants = [
      ...(t?.tenant_name ? [{ name: String(t.tenant_name), note: 'Tenant of record' }] : []),
      ...extra.map(o => ({ name: String(typeof o === 'string' ? o : o?.name ?? '').trim(), note: 'Occupant' })).filter(o => o.name),
    ]

    try {
      const link = await sendEmergencyContactForm({
        associationCode: cx.assoc, legalName, propertyAddress, createdBy: 'owner-portal', notify: false,
        recipient: {
          unitRef: cx.account, party: 'owner',
          audience: t ? 'landlord' : 'resident',
          name: cx.ownerName, email: to ?? '', occupants,
        },
      })
      return NextResponse.json({ ok: true, signUrl: link })
    } catch (e) {
      return NextResponse.json({ error: `Could not start the form: ${e instanceof Error ? e.message : 'error'}` }, { status: 500 })
    }
  }

  // Emergency contact — fields, not a file → satisfies "Emergency Contact".
  // LEGACY: superseded by the signed Emergency Contact List above. Kept so a
  // link already in somebody's inbox does not break; the UI no longer offers it.
  if (body.emergencyContact) {
    const ec = body.emergencyContact
    const name = String(ec.name ?? '').trim()
    if (!name) return NextResponse.json({ error: "Enter the emergency contact's name." }, { status: 400 })
    if (!ec.phone && !ec.email) return NextResponse.json({ error: 'Enter a phone or email.' }, { status: 400 })
    await supabaseAdmin.from('owner_compliance_requests').upsert(
      { association_code: cx.assoc, unit_ref: cx.account, emergency_contact: { name, phone: String(ec.phone ?? '').trim() || null, email: String(ec.email ?? '').trim() || null } },
      { onConflict: 'association_code,unit_ref' },
    ).then(() => null, () => null)
    await markItem(cx.assoc, cx.account, 'unit.emergency', inOneYear())   // re-confirm yearly
    const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
    return NextResponse.json({ ok: true, emergencySaved: true, missing })
  }

  if (body.commercialUseType !== undefined) {
    const saved = await setCommercialUseType(cx.assoc, cx.account, body.commercialUseType, 'owner')
    if (!saved) return NextResponse.json({ error: 'Please pick how the unit is used above first.' }, { status: 409 })
    const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
    return NextResponse.json({ ok: true, commercialUseType: body.commercialUseType, missing })
  }

  const status = body.status as Occupancy
  if (!['owner_occupied', 'leased', 'vacant'].includes(status)) return NextResponse.json({ error: 'pick owner-occupied, leased, or vacant' }, { status: 400 })
  await setUnitOccupancy(cx.assoc, cx.account, status, 'owner')
  const { missing } = await getUnitComplianceState(cx.assoc, cx.account)
  return NextResponse.json({ ok: true, occupancy: status, missing })
}
