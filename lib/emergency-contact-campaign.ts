// =====================================================================
// lib/emergency-contact-campaign.ts
//
// The Emergency Contact List, sent to EVERY owner — whether their unit is
// rented out or they live in it — and to EVERY renter.
//
// Why both, and not just "whoever occupies the unit": the two of them know
// different things. The renter knows who actually sleeps there tonight and who
// to call at 3am. The owner knows who holds a key, who the insurer is, and is
// the person the Association is entitled to reach about the unit itself. A
// list built from only one of them is missing half the emergency.
//
// ONE form that adapts (user direction, 2026-08-16): a non-resident owner is
// confirming their TENANT's household, so the occupant section is prefilled
// from the tenant record and the signed page says who completed it. Everything
// else is asked identically — see lib/esign-forms.tsx.
//
// Sending is DRY RUN by default, like the occupancy survey. This is a mass
// email to residents; the count and the sample come back first, and nothing
// leaves until confirm is passed.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { signEsignToken } from '@/lib/esign-token'
import { sendEmail } from '@/lib/gmail'
import { EMERGENCY_CERTIFICATION, type EmergencyOccupant } from '@/lib/esign-forms'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const emailsOf = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;]/))
    .map(e => String(e ?? '').trim()).filter(e => e.includes('@'))

export type Audience = 'resident' | 'landlord'

export interface Recipient {
  unitRef: string
  /** owner | renter — who we are writing to, not who occupies the unit. */
  party: 'owner' | 'renter'
  audience: Audience
  name: string | null
  email: string
  occupants: EmergencyOccupant[]
}

export interface CampaignResult {
  dryRun: boolean
  associationCode: string
  /** Everyone who would be written to. */
  recipients: { unitRef: string; party: string; audience: Audience; name: string | null; email: string }[]
  sent: number
  skipped: { unitRef: string; party: string; reason: string }[]
  errors: { unitRef: string; email: string; error: string }[]
}

/** Everyone at an association who should hold an emergency contact list. */
export async function emergencyContactRecipients(associationCode: string): Promise<{ recipients: Recipient[]; skipped: CampaignResult['skipped'] }> {
  const code = associationCode.toUpperCase()
  const [{ data: owners }, { data: tenants }] = await Promise.all([
    supabaseAdmin.from('owners')
      .select('account_number, unit_number, first_name, last_name, entity_name, emails')
      .eq('association_code', code).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_tenant_contacts')
      .select('unit_ref, tenant_name, tenant_email, occupants, lease_end')
      .eq('association_code', code),
  ])

  // account_number is the reliable unit key — unit_number is reused across
  // distinct accounts at commercial associations. See [[unit_occupancy_lease_tracking_landscape]].
  const tenantBy = new Map<string, { name: string | null; email: string | null; occupants: EmergencyOccupant[] }>()
  for (const t of tenants ?? []) {
    const ref = String(t.unit_ref ?? '').trim()
    if (!ref) continue
    const extra = (Array.isArray(t.occupants) ? t.occupants : []) as Array<{ name?: string } | string>
    const occupants: EmergencyOccupant[] = [
      ...(t.tenant_name ? [{ name: String(t.tenant_name), note: 'Tenant of record' }] : []),
      ...extra.map(o => ({ name: String(typeof o === 'string' ? o : o?.name ?? '').trim(), note: 'Occupant' }))
        .filter(o => o.name),
    ]
    tenantBy.set(ref, { name: (t.tenant_name as string | null) ?? null, email: (t.tenant_email as string | null) ?? null, occupants })
  }

  const recipients: Recipient[] = []
  const skipped: CampaignResult['skipped'] = []

  // ONE form per UNIT, not one per owner row.
  //
  // A co-owned unit has a row per owner — 231 of 521 units portfolio-wide —
  // and they usually share one mailbox. Emailing per row sent Andre AND Marcia
  // Danford separate forms for the same unit, to the same address, asking for
  // the same list. The unit is what has an emergency contact list, so the unit
  // is what gets one: the owners' names are joined on it, and the link goes to
  // every distinct address they hold. Any one of them can sign it, the same
  // convention the board review round already uses.
  const ownersByUnit = new Map<string, { names: string[]; emails: string[] }>()
  for (const o of owners ?? []) {
    const ref = String(o.account_number ?? '').trim() || String(o.unit_number ?? '').trim()
    if (!ref) continue
    // The owners table carries non-unit accounts — MANXI has one literally
    // called "Manager". A unit reference always contains a number; an account
    // with no digit anywhere in it is not a unit, and would otherwise be sent
    // an emergency contact list for "Unit Manager". Association-generic: it
    // holds for MANXI### and for VPCI's building-letter refs alike.
    if (!/\d/.test(ref)) { skipped.push({ unitRef: ref, party: 'owner', reason: 'not a unit account' }); continue }
    const name = (o.entity_name as string | null)?.trim()
      || [o.first_name, o.last_name].map(x => String(x ?? '').trim()).filter(Boolean).join(' ')
      || ''
    const cur = ownersByUnit.get(ref) ?? { names: [], emails: [] }
    if (name && !cur.names.includes(name)) cur.names.push(name)
    for (const e of emailsOf(o.emails)) if (!cur.emails.some(x => x.toLowerCase() === e.toLowerCase())) cur.emails.push(e)
    ownersByUnit.set(ref, cur)
  }

  for (const [ref, own] of ownersByUnit) {
    if (own.emails.length === 0) { skipped.push({ unitRef: ref, party: 'owner', reason: 'no email on file' }); continue }
    const tenant = tenantBy.get(ref) ?? null
    recipients.push({
      unitRef: ref, party: 'owner',
      // A unit with a tenant record is rented out, so its owner is confirming
      // somebody else's household rather than their own.
      audience: tenant ? 'landlord' : 'resident',
      name: own.names.join(' & ') || null,
      email: own.emails.join(', '),
      occupants: tenant?.occupants ?? [],
    })
  }

  for (const [ref, t] of tenantBy) {
    if (!t.email) { skipped.push({ unitRef: ref, party: 'renter', reason: 'no tenant email on file' }); continue }
    recipients.push({ unitRef: ref, party: 'renter', audience: 'resident', name: t.name, email: t.email, occupants: t.occupants })
  }

  return { recipients, skipped }
}

/** Create ONE emergency contact form and email its link. Returns the link.
 *
 *  `notify: false` creates it without sending mail — for the owner portal,
 *  where the owner is already on the page and is handed the link directly.
 *  Emailing them a link to a page they are looking at is noise. */
export async function sendEmergencyContactForm(opts: {
  associationCode: string
  recipient: Recipient
  legalName: string
  propertyAddress: string | null
  createdBy: string
  notify?: boolean
}): Promise<string> {
  const { associationCode, recipient: r, legalName, propertyAddress, createdBy, notify = true } = opts

  const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
    kind: 'emergency_contact_list',
    association_code: associationCode.toUpperCase(),
    unit_ref: r.unitRef,
    title: `Emergency Contact List — Unit ${r.unitRef}`,
    payload: {
      associationLegalName: legalName,
      propertyAddress,
      audience: r.audience,
      occupants: r.occupants,
      certification: EMERGENCY_CERTIFICATION,
    },
    signers: [{ role: 'resident', name: r.name, email: r.email }],
    status: 'sent',
    compliance_item: 'unit.emergency',
    created_by: createdBy,
  }).select('id').single()
  if (error || !created) throw new Error(error?.message ?? 'could not create the form')

  const link = `${APP}/esign/${await signEsignToken(String(created.id), 'resident')}`
  if (!notify) return link
  const landlord = r.audience === 'landlord'

  await sendEmail({
    to: r.email,
    subject: `Emergency contact list — Unit ${r.unitRef}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
      <p>Hello${r.name ? ` ${esc(r.name)}` : ''},</p>
      <p><strong>${esc(legalName)}</strong> keeps an emergency contact list for every unit${propertyAddress ? ` at ${esc(propertyAddress)}` : ''}. It is who we call if something happens at <strong>Unit ${esc(r.unitRef)}</strong> — a burst pipe, a fire, a storm — and we cannot reach the people who live there.</p>
      ${landlord
        ? `<p>Your unit is tenant-occupied, so the form already lists the residents we have on file. Please check that list is right and give us contacts for the unit.</p>`
        : `<p>It takes about a minute. You will be asked who lives in the unit, one or two people we can call, and whether anyone else holds a key.</p>`}
      <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Complete the emergency contact list →</a></p>
      <p style="color:#6b7280;font-size:12px">No account or password needed — this link is specific to you. You will get a signed copy by email.</p>
      <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties · MAIA keeps your association's records up to date and reminds you when something is due.</p></div>`,
  })
  return link
}

/**
 * The whole campaign for one association.
 *
 * DRY RUN unless `confirm` is true — this sends mail to every owner and every
 * renter at an association, and the count should be read before it goes.
 */
export async function runEmergencyContactCampaign(opts: {
  associationCode: string
  confirm?: boolean
  createdBy: string
  limit?: number
}): Promise<CampaignResult> {
  const code = opts.associationCode.toUpperCase()
  const limit = opts.limit ?? 500
  const dryRun = !opts.confirm

  const [{ data: assoc }, { recipients, skipped }] = await Promise.all([
    supabaseAdmin.from('associations')
      .select('legal_name, association_name, principal_address, city, state, zip')
      .eq('association_code', code).maybeSingle(),
    emergencyContactRecipients(code),
  ])
  const legalName = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const propertyAddress = [assoc?.principal_address, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
    .filter(Boolean).join(', ') || null

  const list = recipients.slice(0, limit)
  const result: CampaignResult = {
    dryRun, associationCode: code,
    recipients: list.map(r => ({ unitRef: r.unitRef, party: r.party, audience: r.audience, name: r.name, email: r.email })),
    sent: 0, skipped, errors: [],
  }
  if (dryRun) return result

  for (const r of list) {
    try {
      await sendEmergencyContactForm({ associationCode: code, recipient: r, legalName, propertyAddress, createdBy: opts.createdBy })
      result.sent++
    } catch (e) {
      result.errors.push({ unitRef: r.unitRef, email: r.email, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return result
}
