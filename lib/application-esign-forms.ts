// =====================================================================
// lib/application-esign-forms.ts
//
// The checklist items that are FORMS MAIA generates, not files anybody can
// upload — and the one place that creates and sends them.
//
// This exists because of a real defect. The request-documents panel listed
// "Rules Knowledge Acknowledgment (e-signed)" and "Pet Registration
// (e-signed)" as ordinary tick boxes, so ticking one emailed the applicant a
// secure UPLOAD link and asked them to upload a document that only MAIA can
// produce. There was nothing for them to upload. The two forms were reachable
// only from separate buttons further down the staff screen, which staff had to
// know about. Emergency Contact List would have joined them.
//
// So: a doc_key either has an entry here, in which case requesting it SENDS
// THE FORM, or it does not, in which case requesting it asks for an upload.
// One decision, in one table, that both the request panel and the dedicated
// buttons read.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { signEsignToken } from '@/lib/esign-token'
import { sendEmail } from '@/lib/gmail'
import { rulesAckContentFor } from '@/lib/rules-ack-content'
import { hasRulesPdf } from '@/lib/rules-ack-pdf'
import { PET_ACK, EMERGENCY_CERTIFICATION } from '@/lib/esign-forms'
import { getHomeownerLedger } from '@/lib/integrations/cinc'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const esc = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))

/** doc_key → the form MAIA sends for it. */
export const ESIGN_CHECKLIST_ITEMS: Record<string, { kind: string; noun: string }> = {
  governing_docs_ack: { kind: 'rules_knowledge_ack', noun: 'Rules Knowledge Acknowledgment' },
  pet_registration:   { kind: 'pet_registration',    noun: 'Animal Information form' },
  emergency_contact:  { kind: 'emergency_contact_list', noun: 'Emergency Contact List' },
  maintenance_assessment_ack: { kind: 'maintenance_assessment_ack', noun: 'Maintenance Assessment Acknowledgment' },
  military_service_disclosure: { kind: 'military_service_disclosure', noun: 'Military Service Member Disclosure' },
}

export const isEsignItem = (docKey: string): boolean => docKey in ESIGN_CHECKLIST_ITEMS

export interface SentForm { docKey: string; kind: string; name: string | null; email: string; link: string }
export interface SendFormsResult {
  sent: SentForm[]
  /** Items that could not be sent, with the reason — surfaced, never swallowed. */
  failed: { docKey: string; reason: string }[]
}

/** What staff already know before the form is even created — an applicant who
 *  named their emergency contacts in the same email that asked "did you get my
 *  documents" shouldn't be sent a blank form asking them to retype it. Keyed
 *  by which form the answer belongs to; a docKey with no matching prefill here
 *  just renders blank, same as before this existed. */
export interface EsignPrefill {
  emergency_contact?: {
    contacts?: { name: string; relationship?: string; phone?: string; email?: string }[]
  }
}

interface AppCtx {
  code: string
  unit: string | null
  type: string | null
  legal: string
  address: string | null
  petLimit: number
  /** Adults on the roster, primary first. Minors sign nothing. */
  people: { id: string; name: string; email: string | null; phone: string | null }[]
}

async function loadCtx(applicationId: string): Promise<AppCtx | null> {
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('association_code, application_type, unit_label').eq('id', applicationId).maybeSingle()
  if (!app) return null
  const code = String(app.association_code)
  const [{ data: assoc }, { data: sh }] = await Promise.all([
    supabaseAdmin.from('associations')
      .select('legal_name, association_name, principal_address, city, state, zip, pet_limit')
      .eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('id, name, email, phone, applicant_role, is_primary')
      .eq('application_id', applicationId).eq('role', 'applicant')
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
  ])
  const people = ((sh ?? []) as { id: string; name: string | null; email: string | null; phone: string | null; applicant_role: string | null }[])
    .filter(p => String(p.applicant_role ?? '') !== 'minor_dependent')
    .map(p => ({ id: String(p.id), name: String(p.name ?? '').trim(), email: p.email ?? null, phone: p.phone ?? null }))
    .filter(p => p.name)
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const unit = (app.unit_label as string | null) ?? null
  const address = [assoc?.principal_address, unit ? `Unit ${unit}` : null,
    [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  return { code, unit, type: (app.application_type as string | null) ?? null, legal, address, petLimit: (assoc?.pet_limit as number | null) ?? 2, people }
}

/** Why this item cannot be sent yet, or null. Checked BEFORE creating anything,
 *  so a blocked item never leaves a half-made document behind. */
export async function esignItemBlocker(docKey: string, c: AppCtx): Promise<string | null> {
  if (c.people.length === 0) return 'nobody is on the applicant roster yet'
  const noEmail = c.people.filter(p => !p.email).map(p => p.name)

  if (docKey === 'governing_docs_ack') {
    if (!rulesAckContentFor(c.code)) return `${c.code} has no Rules Knowledge content configured`
    // The acknowledgment says the Rules follow it. Sending one without them
    // would have somebody e-sign that they have read a document they were
    // never shown.
    if (!await hasRulesPdf(c.code)) return `${c.code} has no Rules and Regulations PDF stored`
    if (noEmail.length) return `no email for ${noEmail.join(', ')} — every adult signs their own block`
    return null
  }
  // The rest are signed by the lead applicant alone.
  if (!c.people[0].email) return `no email for ${c.people[0].name}`
  return null
}

/** Best-effort: the unit's most recent quarterly-assessment charge from CINC's
 *  ledger, so the Maintenance Assessment Acknowledgment shows a real figure
 *  instead of a guess. Conservative on failure, same as the rest of this
 *  codebase's document handling (see lib/occupant-sponsorship.ts) — on any
 *  doubt (no owner on file, no matching ledger line, a network error) the
 *  form simply omits the dollar amount and states the due dates only; it
 *  never shows a wrong number. */
async function currentQuarterlyAssessment(code: string, unit: string | null): Promise<{ amount: number; asOf: string } | null> {
  if (!unit) return null
  try {
    const { data: owner } = await supabaseAdmin.from('owners')
      .select('account_number').eq('association_code', code)
      .or(`unit_number.eq.${unit},account_number.eq.${code}${unit}`)
      .or('status.neq.previous,status.is.null').limit(1).maybeSingle()
    const hoId = owner?.account_number as string | null
    if (!hoId) return null
    const today = new Date()
    const from = new Date(today); from.setDate(from.getDate() - 120)
    const rows = await getHomeownerLedger({
      assocCode: code, hoId,
      fromDate: from.toISOString().slice(0, 10), toDate: today.toISOString().slice(0, 10),
    })
    const assessments = rows
      .filter(r => (r.Debit ?? 0) > 0 && /assess/i.test(`${r.Assessment ?? ''} ${r.Description ?? ''} ${r.TransactionTypeDescription ?? ''}`))
      .sort((a, b) => new Date(b.Date ?? 0).getTime() - new Date(a.Date ?? 0).getTime())
    const latest = assessments[0]
    if (!latest?.Debit || !latest.Date) return null
    return { amount: latest.Debit, asOf: new Date(latest.Date).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) }
  } catch { return null }
}

/** Create + email one form. Returns what was sent, or throws with a reason. */
async function createAndSend(docKey: string, applicationId: string, c: AppCtx, createdBy: string, prefill?: EsignPrefill): Promise<SentForm[]> {
  const spec = ESIGN_CHECKLIST_ITEMS[docKey]
  const lead = c.people[0]
  const unitLabel = c.unit ?? '—'

  // ── Rules Knowledge Acknowledgment: every adult signs their own block ──
  if (docKey === 'governing_docs_ack') {
    const content = rulesAckContentFor(c.code)!
    const signers = c.people.map((p, i) => ({
      role: i === 0 ? 'applicant' : `applicant${i + 1}`, name: p.name, email: p.email,
    }))
    const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
      kind: spec.kind, association_code: c.code, unit_ref: c.unit,
      title: `Rules Knowledge Acknowledgment — ${c.address ?? `Unit ${unitLabel}`}`.trim(),
      payload: {
        associationLegalName: c.legal, propertyAddress: c.address, unit: c.unit,
        applicationType: c.type, applicants: c.people.map(p => p.name), ...content,
      },
      signers, status: 'sent', created_by: createdBy, application_id: applicationId,
    }).select('id').single()
    if (error || !created) throw new Error(error?.message ?? 'could not create it')

    const out: SentForm[] = []
    for (const sg of signers) {
      const link = `${APP}/esign/${await signEsignToken(String(created.id), sg.role)}`
      await sendEmail({
        to: sg.email!,
        subject: `Rules Knowledge Acknowledgment — Unit ${unitLabel}`,
        html: body(c, sg.name, `
          <p><strong>${esc(c.legal)}</strong> asks everyone who will occupy <strong>Unit ${esc(unitLabel)}</strong> to read the Association's Rules and Regulations and acknowledge them. The rules are included in the document — you will read them before you sign.</p>
          <p>Each adult signs their own copy, so this link is yours.</p>`, link, 'Read the rules & e-sign'),
      })
      out.push({ docKey, kind: spec.kind, name: sg.name, email: sg.email!, link })
    }
    return out
  }

  // ── Animal information ────────────────────────────────────────────────
  if (docKey === 'pet_registration') {
    const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
      kind: spec.kind, association_code: c.code, unit_ref: c.unit,
      title: `Animal Information — Unit ${unitLabel}`,
      payload: { associationLegalName: c.legal, petLimit: c.petLimit, rulesAck: PET_ACK },
      signers: [{ role: 'applicant', name: lead.name, email: lead.email, phone: lead.phone }],
      status: 'sent', compliance_item: 'unit.pet', created_by: createdBy, application_id: applicationId,
    }).select('id').single()
    if (error || !created) throw new Error(error?.message ?? 'could not create it')
    const link = `${APP}/esign/${await signEsignToken(String(created.id), 'applicant')}`
    await sendEmail({
      to: lead.email!,
      subject: `Animal information — Unit ${unitLabel}`,
      html: body(c, lead.name, `
        <p><strong>${esc(c.legal)}</strong> asks about any animal that will live at <strong>Unit ${esc(unitLabel)}</strong>. Fill in the short form and e-sign it.</p>
        <p>If your animal is a <strong>service animal</strong> or an <strong>emotional support / assistance animal</strong>, say so on the form. Those are not pets: no pet fee, deposit, or breed or size restriction applies, and you will never be asked for a diagnosis or medical records.</p>`,
        link, 'Complete the animal form & e-sign'),
    })
    return [{ docKey, kind: spec.kind, name: lead.name, email: lead.email!, link }]
  }

  // ── Emergency contact list ────────────────────────────────────────────
  if (docKey === 'emergency_contact') {
    const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
      kind: spec.kind, association_code: c.code, unit_ref: c.unit,
      title: `Emergency Contact List — Unit ${unitLabel}`,
      payload: {
        associationLegalName: c.legal, propertyAddress: c.address,
        // On an APPLICATION the signer is the incoming resident, so they list
        // their own household rather than confirming somebody else's.
        audience: 'resident',
        occupants: c.people.map(p => ({ name: p.name, note: 'Adult' })),
        ...(prefill?.emergency_contact?.contacts?.length ? { contacts: prefill.emergency_contact.contacts } : {}),
        certification: EMERGENCY_CERTIFICATION,
      },
      signers: [{ role: 'resident', name: lead.name, email: lead.email, phone: lead.phone }],
      status: 'sent', compliance_item: 'unit.emergency', created_by: createdBy, application_id: applicationId,
    }).select('id').single()
    if (error || !created) throw new Error(error?.message ?? 'could not create it')
    const link = `${APP}/esign/${await signEsignToken(String(created.id), 'resident')}`
    await sendEmail({
      to: lead.email!,
      subject: `Emergency contact list — Unit ${unitLabel}`,
      html: body(c, lead.name, `
        <p><strong>${esc(c.legal)}</strong> keeps an emergency contact list for every unit — who to call if something happens at <strong>Unit ${esc(unitLabel)}</strong> and we cannot reach the people who live there.</p>
        <p>It takes about a minute: who lives in the unit, one or two people we can call, and whether anyone else holds a key.</p>`,
        link, 'Complete the emergency contact list'),
    })
    return [{ docKey, kind: spec.kind, name: lead.name, email: lead.email!, link }]
  }

  // ── Maintenance Assessment Acknowledgment (purchase-only) ─────────────
  if (docKey === 'maintenance_assessment_ack') {
    const assessment = await currentQuarterlyAssessment(c.code, c.unit)
    const details: { label: string; value: string }[] = [
      { label: 'Property', value: c.address ?? `Unit ${unitLabel}` },
      { label: 'Buyer', value: lead.name },
      { label: 'Due dates', value: 'Jan 1 · Apr 1 · Jul 1 · Oct 1 — considered late on the 5th' },
      // $25.00 per quarter — Amendment to Rule 56 (recorded 1997-05-22, Broward
      // County O.R. Book 26543, Page 0575).
      { label: 'Late fee', value: '$25.00 per quarter if not paid when due (Amendment to Rule 56, recorded 1997)' },
    ]
    if (assessment) {
      details.push({ label: 'Current quarterly assessment', value: `$${assessment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (per the ledger, as of ${assessment.asOf})` })
    }
    const statement = `I acknowledge the due dates and late fee above${assessment ? ', and the current quarterly assessment amount shown,' : ''} and agree to pay the Association's maintenance assessments on schedule as a condition of my purchase. The Association does not bill this amount monthly, and the quarterly amount may change each year by Board action.`
    const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
      kind: spec.kind, association_code: c.code, unit_ref: c.unit,
      title: `Maintenance Assessment Acknowledgment — Unit ${unitLabel}`,
      payload: { associationLegalName: c.legal, statement, details },
      signers: [{ role: 'applicant', name: lead.name, email: lead.email, phone: lead.phone }],
      status: 'sent', created_by: createdBy, application_id: applicationId,
    }).select('id').single()
    if (error || !created) throw new Error(error?.message ?? 'could not create it')
    const link = `${APP}/esign/${await signEsignToken(String(created.id), 'applicant')}`
    await sendEmail({
      to: lead.email!,
      subject: `Maintenance assessment acknowledgment — Unit ${unitLabel}`,
      html: body(c, lead.name, `
        <p><strong>${esc(c.legal)}</strong> asks every buyer to acknowledge the unit's quarterly maintenance assessment and due dates before closing.</p>`,
        link, 'Review & e-sign'),
    })
    return [{ docKey, kind: spec.kind, name: lead.name, email: lead.email!, link }]
  }

  // ── Military Service Member Disclosure (every application type) ───────
  if (docKey === 'military_service_disclosure') {
    const { data: created, error } = await supabaseAdmin.from('esign_documents').insert({
      kind: spec.kind, association_code: c.code, unit_ref: c.unit,
      title: `Military Service Member Disclosure — Unit ${unitLabel}`,
      payload: {
        associationLegalName: c.legal, propertyAddress: c.address, unit: c.unit, applicationType: c.type,
        isServiceMember: null,
        details: [
          { label: 'Property', value: c.address ?? `Unit ${unitLabel}` },
          { label: 'Applicant', value: lead.name },
        ],
      },
      signers: [{ role: 'applicant', name: lead.name, email: lead.email, phone: lead.phone }],
      status: 'sent', created_by: createdBy, application_id: applicationId,
    }).select('id').single()
    if (error || !created) throw new Error(error?.message ?? 'could not create it')
    const link = `${APP}/esign/${await signEsignToken(String(created.id), 'applicant')}`
    await sendEmail({
      to: lead.email!,
      subject: `Military service disclosure — Unit ${unitLabel}`,
      html: body(c, lead.name, `
        <p><strong>${esc(c.legal)}</strong> asks every applicant one short disclosure question required to complete the application.</p>`,
        link, 'Answer & e-sign'),
    })
    return [{ docKey, kind: spec.kind, name: lead.name, email: lead.email!, link }]
  }

  throw new Error(`${docKey} is not a form MAIA sends`)
}

/** The standard MAIA wrapper — branding, association, unit, and what MAIA is. */
function body(c: AppCtx, name: string | null, inner: string, link: string, cta: string): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
    <p>Hello${name ? ` ${esc(name)}` : ''},</p>
    ${inner}
    <p style="margin:22px 0"><a href="${link}" style="background:#f26a1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">${esc(cta)} →</a></p>
    <p style="color:#6b7280;font-size:12px">No account or password needed — this link is specific to you. You will get a signed copy by email.</p>
    <p style="color:#9ca3af;font-size:11px">${esc(c.legal)}${c.address ? ` · ${esc(c.address)}` : ''}<br>
    PMI Top Florida Properties · MAIA keeps your association's records up to date and reminds you when something is due.</p></div>`
}

/**
 * Send every requested item that is a FORM. Returns what went and what didn't.
 *
 * Never throws for one bad item: a request covering four documents must not
 * fail entirely because one association has no Rules PDF stored.
 */
export async function sendEsignFormsForItems(
  applicationId: string, docKeys: string[], createdBy: string, prefill?: EsignPrefill,
): Promise<SendFormsResult> {
  const out: SendFormsResult = { sent: [], failed: [] }
  const keys = [...new Set(docKeys)].filter(isEsignItem)
  if (!keys.length) return out

  const c = await loadCtx(applicationId)
  if (!c) {
    for (const k of keys) out.failed.push({ docKey: k, reason: 'the application could not be read' })
    return out
  }

  for (const k of keys) {
    try {
      const blocked = await esignItemBlocker(k, c)
      if (blocked) { out.failed.push({ docKey: k, reason: blocked }); continue }
      out.sent.push(...await createAndSend(k, applicationId, c, createdBy, prefill))
    } catch (e) {
      out.failed.push({ docKey: k, reason: e instanceof Error ? e.message : 'could not be sent' })
    }
  }
  return out
}

/** Self-serve intake (app/pre-apply/[code]) needs a link to hand the
 *  applicant directly, in-page, right now — not just "an email went out."
 *  Reuses an existing, still-open esign_documents row for this application +
 *  kind instead of minting a new one (and re-emailing) every time the page
 *  loads or is refreshed; only creates + sends once, the first time this
 *  item is reached. Returns null for a docKey this engine doesn't send, or
 *  when creation is genuinely blocked (e.g. no rules PDF on file yet) --
 *  callers fall back to the item's own note/upload path in that case. */
export async function getOrCreateEsignLink(
  applicationId: string, docKey: string, createdBy: string, prefill?: EsignPrefill,
): Promise<{ url: string; completed: boolean } | null> {
  const spec = ESIGN_CHECKLIST_ITEMS[docKey]
  if (!spec) return null

  const { data: existing } = await supabaseAdmin.from('esign_documents')
    .select('id, status, signers')
    .eq('application_id', applicationId).eq('kind', spec.kind)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (existing) {
    const signers = (existing.signers ?? []) as { role: string }[]
    const role = signers[0]?.role ?? 'applicant'
    const url = `${APP}/esign/${await signEsignToken(String(existing.id), role)}`
    return { url, completed: existing.status === 'completed' }
  }

  const result = await sendEsignFormsForItems(applicationId, [docKey], createdBy, prefill)
  const sent = result.sent.find(s => s.docKey === docKey)
  return sent ? { url: sent.link, completed: false } : null
}
