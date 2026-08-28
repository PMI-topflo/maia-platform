// =====================================================================
// lib/approval-distribution.ts
//
// When the board finishes signing an application's Board Decision, MAIA emails
// the signed approval letter (PDF attached) to EVERY party: applicant, owner,
// both agents, the board members who signed, the on-site manager, and PMI +
// Jonathan. Everyone is BCC'd — no one sees anyone else's address — and the body
// names each party so they know who received a copy.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import type { EsignDoc } from '@/lib/esign'
import { buildManorsClubWelcomePackage } from '@/lib/manors-club-welcome-package'

// MANXI's master association (Manors Club Inc.) issues its own amenity
// forms — MAIA doesn't manage them, so an approved MANXI applicant gets
// those forms PRE-FILLED to print and present in person, alongside the
// approval letter. User direction, 2026-08-28 (source: the real "Manors
// Club Files.pdf" from Greg Rullo, Grant Property Management — the Club's
// management company). MANXI-only; every other association is unaffected.
const MANORS_CLUB_SOURCE_PDF_PATH = 'MANXI/manors-club-welcome-package/source.pdf'
const MANORS_CLUB_BUILDING_ADDRESS = '4174 Inverrary Drive'
const MANORS_CLUB_CONTACT = {
  name: 'Greg Rullo, LCAM', company: 'Grant Property Management',
  phone: '(954) 718-9903 ext. 512', email: 'greg@grantmgmt.com',
  address: '7124 North Nob Hill Road, Tamarac, FL 33321',
}

const SUPPORT = 'support@topfloridaproperties.com'
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)
const esc = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const emails = (raw: string | null | undefined) => (raw ?? '').split(/[,;]/).map(s => s.trim()).filter(e => e.includes('@'))

// "Purchase" → "purchase application"; renewal reads naturally on its own.
const TYPE_NOUN: Record<string, string> = {
  lease: 'lease application', purchase: 'purchase application',
  lease_renewal: 'lease renewal', additional_occupant: 'additional-occupant application',
}
const TYPE_TITLE: Record<string, string> = {
  lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant',
}

interface Party { role: string; name: string | null; email: string }

/** Email the signed approval letter to every party. Best-effort; never throws. */
export async function distributeApprovalLetter(opts: { doc: EsignDoc; applicationId: string; pdf: Buffer }): Promise<{ sent: number }> {
  const { doc, applicationId, pdf } = opts
  const code = String(doc.association_code), unit = String(doc.unit_ref ?? '')

  const [{ data: app }, { data: assoc }, { data: people }, { data: owners }, { data: mgrs }] = await Promise.all([
    supabaseAdmin.from('listing_applications').select('application_type, lease_start, lease_end').eq('id', applicationId).maybeSingle(),
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('role, name, email, phone, is_primary').eq('application_id', applicationId).order('is_primary', { ascending: false }),
    supabaseAdmin.from('owners').select('first_name, last_name, entity_name, emails').eq('association_code', code).or(`unit_number.eq.${unit},account_number.eq.${code}${unit}`).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('building_managers').select('first_name, last_name, email').eq('association_code', code).eq('active', true),
  ])

  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const address = [assoc?.principal_address, unit ? `Unit ${unit}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  const type = String(app?.application_type ?? '')
  const typeNoun = TYPE_NOUN[type] ?? 'application'
  const typeTitle = TYPE_TITLE[type] ?? 'Application'

  const applicants = (people ?? []).filter(p => p.role === 'applicant')
  const applicantNames = applicants.map(p => String(p.name ?? '').trim()).filter(Boolean)
  const lead = applicantNames[0] ?? 'the applicant'

  // MANXI only: pre-fill the master association's own real amenity forms
  // (Proximity Card / Recreational I.D. Pass Registration, Elevator/Gate
  // Pass) with what's already on file, so the approved resident has
  // something to print and hand the Manors Club office in person — MAIA
  // doesn't submit anything to them directly. Best-effort: any failure here
  // (missing source PDF, a malformed field) must never block the approval
  // letter itself from going out.
  let manorsClub: { proximityCardForm: Uint8Array; elevatorGatePassForm: Uint8Array } | null = null
  if (code === 'MANXI' && unit) {
    try {
      const primary = applicants.find(a => a.is_primary) ?? applicants[0]
      const ownerRow = (owners ?? [])[0]
      const ownerName = (String(ownerRow?.entity_name ?? '').trim() || `${ownerRow?.first_name ?? ''} ${ownerRow?.last_name ?? ''}`.trim()) || lead
      const { data: srcBlob } = await supabaseAdmin.storage.from('application-docs').download(MANORS_CLUB_SOURCE_PDF_PATH)
      if (srcBlob) {
        const sourcePdf = Buffer.from(await srcBlob.arrayBuffer())
        manorsClub = await buildManorsClubWelcomePackage({
          sourcePdf,
          ownerName,
          unitAddress: `${MANORS_CLUB_BUILDING_ADDRESS}, Unit ${unit}`,
          unitLabel: unit,
          scenario: type === 'purchase' ? 'owner_occupant' : 'tenant',
          residentNames: applicantNames,
          leaseStart: (app?.lease_start as string | null) ?? null,
          leaseEnd: (app?.lease_end as string | null) ?? null,
          applicantName: (primary?.name as string | null) || lead,
          applicantPhone: (primary?.phone as string | null) ?? null,
          applicantEmail: (primary?.email as string | null) ?? null,
        })
      }
    } catch { /* never block the letter over this */ }
  }

  // Build the party list — each row is a person we're copying.
  const parties: Party[] = []
  const add = (role: string, name: string | null, addrs: string[]) => { for (const e of addrs) parties.push({ role, name, email: e }) }
  for (const a of applicants) add('Applicant', a.name as string | null, emails(a.email as string | null))
  for (const o of owners ?? []) {
    const nm = (String(o.entity_name ?? '').trim() || `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim()) || null
    add('Owner', nm, emails(o.emails as string | null))
  }
  for (const p of people ?? []) {
    if (p.role === 'listing_agent') add("Owner's agent", p.name as string | null, emails(p.email as string | null))
    if (p.role === 'applicant_agent') add("Applicant's agent", p.name as string | null, emails(p.email as string | null))
  }
  for (const s of doc.signers) if (s.signed_at && s.email) add('Board', s.name ?? null, [s.email])
  for (const m of mgrs ?? []) add('On-site manager', `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || null, emails(m.email as string | null))
  for (const e of NOTIFY) add('PMI Top Florida Properties', null, [e])

  // De-dupe by address, keeping the first (most specific) role.
  const seen = new Set<string>()
  const uniq = parties.filter(p => { const k = p.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  if (uniq.length === 0) return { sent: 0 }

  const rows = uniq.map(p => `<tr><td style="padding:9px 14px;border-top:1px solid #f2efe8;font-size:13.5px;color:#1c2333"><span style="display:inline-block;min-width:104px;font:700 10.5px system-ui;text-transform:uppercase;letter-spacing:.04em;color:#c0571a;background:#f8efe6;border-radius:999px;padding:3px 9px;text-align:center;margin-right:8px">${esc(p.role)}</span><b>${esc(p.name ?? '—')}</b></td></tr>`).join('')

  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#eceef2;padding:24px 12px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7e2d9;border-radius:12px;padding:30px 34px 26px">
      <div style="font:700 11px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#c0571a;margin-bottom:10px">PMI Top Florida Properties</div>
      <h1 style="font:800 24px/1.2 Georgia,serif;color:#1c2333;margin:0 0 4px">Your ${esc(typeNoun)} has been approved</h1>
      <div style="font-size:14px;color:#8a8f9a;margin:0 0 12px">${esc(typeTitle)}${address ? ` — ${esc(address)}` : ''}${applicantNames.length ? ` · ${esc(applicantNames.join(', '))}` : ''}</div>
      <div style="display:inline-block;background:#e9f4ed;color:#15803d;font:700 12px system-ui;border-radius:999px;padding:4px 12px;margin-bottom:14px">🎉 Congratulations to all!</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e7e2d9;border-radius:10px;overflow:hidden;margin:0 0 18px">
        <tr><td style="width:98px;color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 13px;background:#faf8f4">Association</td><td style="padding:8px 13px;font-weight:600;color:#1c2333">${esc(legal)}</td></tr>
        ${address ? `<tr><td style="color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 13px;border-top:1px solid #f2efe8">Property</td><td style="padding:8px 13px;font-weight:600;color:#1c2333;border-top:1px solid #f2efe8">${esc(address)}</td></tr>` : ''}
        ${applicantNames.length ? `<tr><td style="color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 13px;border-top:1px solid #f2efe8">Applicant</td><td style="padding:8px 13px;font-weight:600;color:#1c2333;border-top:1px solid #f2efe8">${esc(applicantNames.join(', '))}</td></tr>` : ''}
        <tr><td style="color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 13px;border-top:1px solid #f2efe8">Decision</td><td style="padding:8px 13px;font-weight:700;color:#15803d;border-top:1px solid #f2efe8">Approved · ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>
      </table>
      <p style="font-size:14.5px;color:#3f4756;margin:0 0 14px">Good news — the Board of Directors has <b>approved the ${esc(typeNoun)}</b> of <b>${esc(lead)}</b>${address ? ` for <b>${esc(address)}</b>` : ''}. The signed board approval letter is <b>attached to this email</b> for your records.</p>
      <div style="font:700 11.5px system-ui;text-transform:uppercase;letter-spacing:.06em;color:#8a8f9a;margin:0 0 8px">Everyone below has received a copy</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e7e2d9;border-radius:10px;overflow:hidden;margin:0 0 18px">${rows}</table>
      <p style="font-size:14.5px;color:#3f4756;margin:0 0 16px">No further action is needed from you — we&apos;ll complete the association&apos;s filing. If anything looks incorrect, just reply to this email.</p>
      ${manorsClub ? `<div style="border:1px solid #e7e2d9;border-radius:10px;padding:14px 16px;margin:0 0 18px">
        <div style="font:700 12.5px system-ui;color:#1c2333;margin:0 0 6px">🏊 Manors Club amenities — two forms attached, pre-filled</div>
        <p style="font-size:13.5px;color:#3f4756;margin:0 0 8px;line-height:1.5">The Manors of Inverrary&apos;s recreational facilities (pool, gym, clubhouse) are managed by a separate entity, <b>Manors Club Inc.</b> — not PMI. We&apos;ve <b>pre-filled their own registration forms</b> with what&apos;s already on file; <b>print, sign, and bring them in person</b> along with a valid ID and the listed fee:</p>
        <ul style="font-size:13.5px;color:#3f4756;margin:0 0 10px;padding-left:20px;line-height:1.6">
          <li><b>Proximity Card / Recreational I.D. Pass Registration</b> (attached) — required for the pools, gym, and to reserve the pool deck or event hall. $10 first card, $25 each additional (cash).</li>
          <li><b>Elevator/Gate Pass</b> (attached) — required for move-in; submit at least 3 business days ahead. $40 non-refundable (money order).</li>
          <li><b>Front Gate Entry Barcode</b> (no form — bring a valid vehicle registration + driver&apos;s license + $5 cash).</li>
          <li><b>Manors Club I.D. Card</b> (no form — bring a government-issued ID + $5 cash).</li>
        </ul>
        <p style="font-size:13.5px;color:#3f4756;margin:0 0 4px">Manors Club Management Office — open Mon–Fri, 8:00am–4:30pm.</p>
        <p style="font-size:13px;color:#6b7280;margin:0">${esc(MANORS_CLUB_CONTACT.name)}, ${esc(MANORS_CLUB_CONTACT.company)} · ☎ ${esc(MANORS_CLUB_CONTACT.phone)} · ✉ <a href="mailto:${MANORS_CLUB_CONTACT.email}" style="color:#c0571a">${esc(MANORS_CLUB_CONTACT.email)}</a><br>${esc(MANORS_CLUB_CONTACT.address)}</p>
      </div>` : ''}
      <div style="display:flex;gap:12px;background:#f8efe6;border-radius:10px;padding:14px 16px;margin:0 0 18px">
        <div style="font-size:22px;line-height:1">✦</div>
        <div style="font-size:13px;color:#3f4756"><b style="color:#c0571a">What is MAIA?</b> MAIA is PMI Top Florida Properties&apos; document assistant. It keeps your association paperwork organized and secure and flags anything expiring — so approvals move faster for you.</div>
      </div>
      <div style="border-top:1px solid #e7e2d9;padding-top:14px;font-size:12px;color:#8a8f9a;line-height:1.6">
        <b style="color:#3f4756">PMI Top Florida Properties</b> — for ${esc(legal)}.<br>
        Questions? Reply to this email or contact <a href="mailto:${SUPPORT}" style="color:#c0571a">${SUPPORT}</a>.<br>
        You&apos;re receiving this because you are a party to the application${unit ? ` for Unit ${esc(unit)}` : ''}.
      </div>
    </div>
  </div>`

  // Everyone BCC'd (To: support) so no party sees another's address.
  await sendEmail({
    to: [SUPPORT], bcc: uniq.map(p => p.email), replyTo: SUPPORT,
    subject: `✅ ${typeTitle} approved — ${unit ? `Unit ${unit}, ` : ''}${legal}`,
    html,
    attachments: [
      { filename: 'Board_Approval_Letter.pdf', content: pdf.toString('base64') },
      ...(manorsClub ? [
        { filename: 'Manors_Club_Proximity_Card_Registration.pdf', content: Buffer.from(manorsClub.proximityCardForm).toString('base64') },
        { filename: 'Manors_Club_Elevator_Gate_Pass_Application.pdf', content: Buffer.from(manorsClub.elevatorGatePassForm).toString('base64') },
      ] : []),
    ],
  })

  // Register it on the letter so it shows in the application's communication
  // history ("approval letter emailed to N parties", with who).
  const { mergeEsignPayload } = await import('@/lib/esign')
  await mergeEsignPayload(doc.id, {
    distribution: { at: new Date().toISOString(), recipients: uniq.map(p => ({ role: p.role, name: p.name, email: p.email })) },
  }).catch(() => null)

  return { sent: uniq.length }
}
