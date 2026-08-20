// =====================================================================
// lib/esign.ts
//
// Core server helpers for the shared association e-sign engine. Loads an
// esign_documents row, records a signer's signature (gated by the verified-
// signature layer in lib/esign-verify), stamps their verification certificate,
// and — when every required signer has signed — marks the document completed
// and optionally files a compliance record. Per-form behavior (roles, PDF)
// lives in lib/esign-forms.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import type { RoleVerification } from '@/lib/esign-verify'
import { computeFormExpiry, getFormDef } from '@/lib/esign-forms'
import { sendEmail } from '@/lib/gmail'

export type EsignStatus = 'draft' | 'sent' | 'partially_signed' | 'completed' | 'void'

export interface EsignSigner {
  role: string
  name: string | null
  email: string | null
  phone: string | null
  signed_at?: string | null
  sig_name?: string | null
  sig_image?: string | null
  sig_ip?: string | null
  verification?: RoleVerification | null
}

export interface EsignDoc {
  id: string
  kind: string
  association_code: string
  unit_ref: string | null
  title: string | null
  payload: Record<string, unknown>
  signers: EsignSigner[]
  status: EsignStatus
  compliance_item: string | null
  created_at: string
  application_id: string | null
}

const COLS = 'id, kind, association_code, unit_ref, title, payload, signers, status, compliance_item, created_at, application_id'

export async function getEsignDoc(id: string): Promise<EsignDoc | null> {
  const { data } = await supabaseAdmin.from('esign_documents').select(COLS).eq('id', id).maybeSingle()
  if (!data) return null
  const d = data as EsignDoc
  d.signers = Array.isArray(d.signers) ? d.signers : []
  d.payload = (d.payload && typeof d.payload === 'object') ? d.payload : {}
  return d
}

export function signerOf(doc: EsignDoc, role: string): EsignSigner | null {
  return doc.signers.find(s => s.role === role) ?? null
}
export function roleEmail(doc: EsignDoc, role: string): string | null {
  return signerOf(doc, role)?.email ?? null
}
export function rolePhone(doc: EsignDoc, role: string): string | null {
  return signerOf(doc, role)?.phone ?? null
}
export function rolePhoneRequired(doc: EsignDoc, role: string): boolean {
  return !!(rolePhone(doc, role) ?? '').trim()
}
export function roleVerification(doc: EsignDoc, role: string): RoleVerification | null {
  return signerOf(doc, role)?.verification ?? null
}
export function roleSigned(doc: EsignDoc, role: string): boolean {
  return !!signerOf(doc, role)?.signed_at
}

/** Replace one signer in the array (read-modify-write on the jsonb column). */
async function patchSigner(id: string, role: string, patch: Partial<EsignSigner>, extra?: Record<string, unknown>): Promise<EsignDoc | null> {
  const doc = await getEsignDoc(id)
  if (!doc) return null
  const signers = doc.signers.map(s => s.role === role ? { ...s, ...patch } : s)
  await supabaseAdmin.from('esign_documents').update({ signers, updated_at: new Date().toISOString(), ...extra }).eq('id', id)
  return { ...doc, signers }
}

/** Merge a patch into the document's payload (applicant-filled fields). */
export async function mergeEsignPayload(id: string, patch: Record<string, unknown>): Promise<void> {
  const doc = await getEsignDoc(id)
  if (!doc) return
  const next = { ...doc.payload, ...patch }
  await supabaseAdmin.from('esign_documents').update({ payload: next, updated_at: new Date().toISOString() }).eq('id', id)
}

/** Merge a patch into the role's verification certificate. */
export async function setEsignVerification(id: string, role: string, patch: RoleVerification): Promise<RoleVerification> {
  const doc = await getEsignDoc(id)
  const current = (doc ? roleVerification(doc, role) : null) ?? {}
  const next: RoleVerification = { ...current, ...patch }
  await patchSigner(id, role, { verification: next })
  return next
}

export interface EsignSignInput { name: string; image: string | null; ip: string | null }

/** Record one signer's signature. Idempotent-safe. When every required role
 *  (per the form registry) has signed, marks completed and files the optional
 *  compliance item. */
export async function recordEsignSignature(
  id: string, role: string, input: EsignSignInput,
): Promise<{ ok: true; status: EsignStatus; complete: boolean } | { ok: false; error: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Please type your full legal name.' }

  const doc = await getEsignDoc(id)
  if (!doc) return { ok: false, error: 'This signing link is no longer valid.' }
  if (doc.status === 'void') return { ok: false, error: 'This document has been voided.' }
  if (!signerOf(doc, role)) return { ok: false, error: 'You are not a signer on this document.' }
  if (roleSigned(doc, role)) return { ok: false, error: 'You have already signed this document.' }

  const now = new Date().toISOString()
  const after = await patchSigner(id, role, { signed_at: now, sig_name: name, sig_image: input.image, sig_ip: input.ip })
  if (!after) return { ok: false, error: 'Could not save your signature.' }

  // A receipt to the person who JUST signed — not whoever signed last, not
  // only once every signer is done. Before this, nobody who signed anything
  // (any esign kind, not only the three built this week) was ever told their
  // own signature was received; the only confirmation was the browser page
  // they were already looking at, which tells them nothing once they close
  // the tab. Generic across every esign kind — one place, not one per form.
  const signer = after.signers.find(sg => sg.role === role)
  if (signer?.email) {
    const formLabel = getFormDef(doc.kind)?.label ?? doc.title ?? 'the document'
    await sendEmail({
      to: signer.email,
      subject: `Signed — ${formLabel}${doc.unit_ref ? ` (Unit ${doc.unit_ref})` : ''}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5">
        <p>Hello${signer.name ? ` ${signer.name}` : ''},</p>
        <p>This confirms your signature on <strong>${formLabel}</strong>${doc.unit_ref ? ` for Unit ${doc.unit_ref}` : ''}, received ${new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} ET.</p>
        <p style="color:#6b7280;font-size:12px">PMI Top Florida Properties</p></div>`,
    }).catch(() => null)
  }

  // Complete when every signer attached to the document has signed (supports a
  // variable number of signers, e.g. two board approvers).
  const complete = after.signers.length > 0 && after.signers.every(sg => !!sg.signed_at)
  const status: EsignStatus = complete ? 'completed' : 'partially_signed'
  await supabaseAdmin.from('esign_documents').update({ status, updated_at: now }).eq('id', id)

  if (complete && doc.compliance_item && doc.unit_ref) {
    const expiry = computeFormExpiry(after)
    let statusVal = 'current'
    if (expiry) {
      const d = new Date(expiry), n = new Date()
      statusVal = d < n || (d.getTime() - n.getTime()) / 86_400_000 <= 45 ? 'expiring' : 'current'
    }
    await supabaseAdmin.from('compliance_records').upsert({
      scope: 'unit', association_code: doc.association_code, unit_ref: doc.unit_ref,
      item_key: doc.compliance_item, applicable: true, status: statusVal, expiry_date: expiry,
      updated_by: `system:esign:${doc.kind}`, updated_at: now,
    }, { onConflict: 'scope,association_code,unit_ref,item_key' }).then(() => null, () => null)
  }

  // A fully-signed Board Decision IS the approval letter — file it against the
  // unit's in-process application so the "Board Approval Letter" checklist item
  // is satisfied automatically (best-effort; never blocks signing).
  //
  // approval_sent -> approved, fully automatic: the same signing completion
  // that files the letter also runs the actual Drive-filing/archiving
  // (lib/board-approve.ts, previously dry-run-gated behind a manual staff
  // click) and the screening-provider handoff (lib/application-handoff.ts,
  // previously only reachable from the manual PATCH approve action). User
  // direction, 2026-08-20: "Move forward, I want all fully automatic."
  if (complete && doc.kind === 'board_decision' && doc.unit_ref) {
    const filedApplicationId = await fileBoardApprovalLetter(id).catch(() => null)
    if (filedApplicationId) {
      const { runBoardApprove } = await import('@/lib/board-approve')
      const outcome = await runBoardApprove(filedApplicationId).catch(e => ({ error: e instanceof Error ? e.message : String(e) }))
      if (!('error' in outcome)) {
        const { handoffOnApproval } = await import('@/lib/application-handoff')
        await handoffOnApproval(filedApplicationId, 'board').catch(() => null)
      }
    }
  }

  // A fully-signed Rules Knowledge Acknowledgment satisfies the checklist item
  // of the same name — file it so staff never chase a document the applicants
  // have already signed.
  if (complete && doc.kind === 'rules_knowledge_ack' && doc.unit_ref) {
    await fileEsignToApplication(id, {
      docKey: 'governing_docs_ack', docLabel: 'Rules Knowledge Acknowledgment (e-signed)',
      filename: 'Rules_Knowledge_Acknowledgment.pdf', assemble: true,
    }).catch(() => null)
  }

  // A completed Pet Registration satisfies the pet item on an in-process
  // application the same way. It also carries its own renewal expiry, which the
  // checklist row then tracks like any other expiring document.
  if (complete && doc.kind === 'pet_registration' && doc.unit_ref) {
    await fileEsignToApplication(id, {
      docKey: 'pet_registration', docLabel: 'Pet Registration (e-signed)',
      filename: 'Pet_Registration.pdf',
    }).catch(() => null)
    // The animals themselves as queryable rows, not just JSON inside the
    // signed PDF — see applyPetRegistrationAnswers below for why this matters.
    await applyPetRegistrationAnswers(id).catch(() => null)
  }

  // A completed Emergency Contact List satisfies the checklist item of the same
  // name. It is normally sent as an association-wide campaign rather than as
  // part of an application, so most of the time there is no application to file
  // it against — fileEsignToApplication simply finds none and stops. When there
  // IS one in process, staff should not be chasing a list already signed.
  if (complete && doc.kind === 'emergency_contact_list' && doc.unit_ref) {
    await fileEsignToApplication(id, {
      docKey: 'emergency_contact', docLabel: 'Emergency Contact List (e-signed)',
      filename: 'Emergency_Contact_List.pdf',
    }).catch(() => null)
    // The survey's answers are only worth collecting if they land somewhere the
    // rest of MAIA reads. This is the step that turns it from a filed PDF into
    // a unit whose occupancy is known and whose tenants can be written to.
    await applyUnitSurveyAnswers(id).catch(() => null)
  }

  return { ok: true, status, complete }
}

/** File a completed e-sign document onto the unit's in-process application, so
 *  the checklist item it satisfies stops asking for something already signed.
 *  `assemble` is for kinds whose real PDF is more than the bare render (the
 *  rules acknowledgment splices in the association's own Rules pages). */
/**
 * Push a signed unit survey's answers into the records the rest of MAIA reads.
 *
 * Without this the survey is a PDF in a folder: the unit's occupancy stays
 * unknown, the tenants stay unreachable, and the next email still goes out in
 * English to whoever the Association happened to have on file. The whole point
 * of asking is that the NEXT round can write to the right person, in their
 * language, for the documents that are actually theirs.
 *
 * Best-effort throughout, and deliberately non-destructive: a tenant already on
 * file is UPDATED, never replaced, so a survey that names one of two tenants
 * does not silently delete the other. Signing must never fail because a
 * downstream write did.
 */
async function applyUnitSurveyAnswers(esignDocId: string): Promise<void> {
  const doc = await getEsignDoc(esignDocId)
  if (!doc?.unit_ref) return
  const p = doc.payload as {
    occupancy?: 'owner_occupied' | 'leased' | 'vacant'
    language?: string
    tenants?: { name?: string; email?: string; phone?: string }[]
    audience?: string
    party?: 'owner' | 'renter'
  }
  const assoc = doc.association_code, unit = doc.unit_ref
  const now = new Date().toISOString()
  const signer = doc.signers.find(sg => sg.signed_at) ?? null
  const by = `esign:unit_survey:${signer?.name ?? 'signer'}`

  // 1. Occupancy — the answer that decides which documents a unit owes at all.
  if (p.occupancy) {
    const { setUnitOccupancy } = await import('@/lib/unit-required-docs')
    await setUnitOccupancy(assoc, unit, p.occupancy, by).catch(() => null)
  }

  // 2. Language — stored on the PERSON who answered, which is why `party` is
  //    stamped on the payload at creation. An owner and their tenant are two
  //    different answers about the same unit, and writing a renter's choice
  //    onto the owners record would change the language the LANDLORD is
  //    written to. `audience` cannot carry this: a renter and an
  //    owner-occupier are both 'resident'.
  if (p.language) {
    if (p.party === 'renter') {
      await supabaseAdmin.from('unit_tenant_contacts')
        .update({ preferred_language: p.language, updated_at: now })
        .eq('association_code', assoc).eq('unit_ref', unit)
        .then(() => null, () => null)
    } else {
      await supabaseAdmin.from('owners')
        .update({ preferred_language: p.language })
        .eq('association_code', assoc)
        .or(`account_number.eq.${unit},unit_number.eq.${unit}`)
        .then(() => null, () => null)
    }
  }

  // 3. Tenants — the gap this survey exists to close. Their email is what lets
  //    the next round ask them directly instead of routing it via the landlord.
  const tenants = (p.tenants ?? []).filter(t => String(t.name ?? '').trim())
  if (p.occupancy === 'leased' && tenants.length > 0) {
    const lead = tenants[0]
    const { data: existing } = await supabaseAdmin.from('unit_tenant_contacts')
      .select('id, tenant_name, tenant_email, tenant_phone')
      .eq('association_code', assoc).eq('unit_ref', unit).maybeSingle()

    // Only fill what the survey actually answered — a blank field on the form
    // is "not supplied", never "delete what you had".
    const patch: Record<string, unknown> = { updated_at: now }
    if (lead.name) patch.tenant_name = lead.name
    if (lead.email) patch.tenant_email = lead.email
    if (lead.phone) patch.tenant_phone = lead.phone
    if (p.language) patch.preferred_language = p.language
    // Everyone after the first is an additional occupant on the same record.
    if (tenants.length > 1) {
      patch.occupants = tenants.slice(1).map(t => ({ name: t.name, email: t.email ?? null, phone: t.phone ?? null }))
    }

    if (existing) {
      await supabaseAdmin.from('unit_tenant_contacts').update(patch).eq('id', existing.id).then(() => null, () => null)
    } else {
      await supabaseAdmin.from('unit_tenant_contacts')
        .insert({ association_code: assoc, unit_ref: unit, ...patch })
        .then(() => null, () => null)
    }
  }
}

/**
 * Push a completed Pet Registration's animals into `unit_pets` as real rows.
 *
 * Without this, "does unit 613 have a dog" is a question nobody can answer
 * without opening a signed PDF and reading it — the pet data existed, but
 * only as JSON trapped inside one document. This is the same move as
 * applyUnitSurveyAnswers above: the signed form stays the legal record; the
 * content it captured also becomes something the rest of MAIA can query.
 *
 * SUPERSEDE, NEVER OVERWRITE: a fresh registration marks the unit's prior
 * active rows inactive and inserts the new set fresh, rather than updating
 * rows in place. A signed record of what was previously on file is worth
 * keeping even after it's superseded — same convention as the emergency
 * contact list's own re-signing.
 */
async function applyPetRegistrationAnswers(esignDocId: string): Promise<void> {
  const doc = await getEsignDoc(esignDocId)
  if (!doc?.unit_ref) return
  const p = doc.payload as { pets?: { type?: string; name?: string; breed?: string; color?: string; weight?: string; age?: string; sex?: string; altered?: boolean; license?: string; rabiesDate?: string; vaccinationDoc?: { path: string } | null; photo?: { path: string } | null; serviceAnimal?: boolean }[]; questionnaire?: { requestType?: string } }
  const pets = (p.pets ?? []).filter(a => (a.name ?? a.type ?? '').trim())
  if (pets.length === 0) return

  const assoc = doc.association_code, unit = doc.unit_ref, now = new Date().toISOString()
  // The questionnaire branch, when this document went through it — a service
  // animal or ESA is never subject to the association's ordinary pet rules,
  // fees or limits, and a report over this table needs to tell them apart
  // without re-reading the PDF.
  const kind = p.questionnaire?.requestType === 'service' ? 'service'
    : p.questionnaire?.requestType === 'esa' ? 'esa'
    : p.questionnaire?.requestType === 'unsure' ? 'unsure' : 'pet'

  await supabaseAdmin.from('unit_pets').update({ active: false, updated_at: now })
    .eq('association_code', assoc).eq('unit_ref', unit).eq('active', true)
    .then(() => null, () => null)

  await supabaseAdmin.from('unit_pets').insert(pets.map(a => ({
    association_code: assoc, unit_ref: unit, esign_document_id: esignDocId, kind,
    animal_type: a.type || null, name: a.name || null, breed: a.breed || null, color: a.color || null,
    weight: a.weight || null, age: a.age || null, sex: a.sex || null, altered: a.altered ?? null,
    license_number: a.license || null, rabies_date: a.rabiesDate || null,
    vaccination_doc_path: a.vaccinationDoc?.path || null, photo_path: a.photo?.path || null,
    active: true,
  }))).then(() => null, () => null)
}

async function fileEsignToApplication(
  esignDocId: string,
  opts: { docKey: string; docLabel: string; filename: string; assemble?: boolean },
): Promise<void> {
  const fresh = await getEsignDoc(esignDocId)
  if (!fresh || !fresh.unit_ref) return

  let pdf: Buffer
  if (opts.assemble) {
    const { assembleRulesAckPdf } = await import('@/lib/rules-ack-content')
    pdf = await assembleRulesAckPdf(fresh)
  } else {
    const { renderToBuffer } = await import('@react-pdf/renderer')
    const { renderFormPdf } = await import('@/lib/esign-forms')
    const el = renderFormPdf(fresh)
    if (!el) return
    pdf = Buffer.from(await renderToBuffer(el))
  }

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id').eq('association_code', fresh.association_code).eq('unit_label', fresh.unit_ref)
    .in('status', ['started', 'submitted', 'under_review', 'approval_sent', 'approved']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!app) return

  const path = `intake/${app.id}/${opts.docKey}/${crypto.randomUUID()}.pdf`
  const up = await supabaseAdmin.storage.from('application-docs').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (up.error) return
  await supabaseAdmin.from('application_documents').delete().eq('application_id', app.id).eq('doc_key', opts.docKey).is('stakeholder_id', null)

  // Carry the form's own expiry onto the checklist row (pet registrations renew).
  const { getFormDef } = await import('@/lib/esign-forms')
  const expiry = getFormDef(fresh.kind)?.computeExpiry?.(fresh) ?? null

  await supabaseAdmin.from('application_documents').insert({
    application_id: app.id, listing_id: app.listing_id, kind: 'other',
    doc_key: opts.docKey, doc_label: opts.docLabel,
    storage_path: path, filename: opts.filename, suggested_name: opts.filename,
    mime_type: 'application/pdf', uploaded_by_role: 'esign',
    expiration_date: expiry,
  })
}

async function fileBoardApprovalLetter(esignDocId: string): Promise<string | null> {
  const fresh = await getEsignDoc(esignDocId)
  if (!fresh || !fresh.unit_ref) return null
  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { renderFormPdf } = await import('@/lib/esign-forms')
  const el = renderFormPdf(fresh)
  if (!el) return null
  const pdf = Buffer.from(await renderToBuffer(el))

  // The letter's own application_id, when set (every letter createBoardDecisionLetter
  // creates going forward), is authoritative — no ambiguity even if the unit has
  // two in-process applications at once (e.g. a lease application and a later
  // additional-occupant one). Older rows without it fall back to the previous
  // association_code + unit_ref + status-filtered lookup.
  const app = fresh.application_id
    ? await supabaseAdmin.from('listing_applications').select('id, listing_id').eq('id', fresh.application_id).maybeSingle().then(r => r.data)
    : await supabaseAdmin.from('listing_applications')
        .select('id, listing_id').eq('association_code', fresh.association_code).eq('unit_label', fresh.unit_ref)
        .in('status', ['started', 'submitted', 'under_review', 'approval_sent', 'approved']).order('created_at', { ascending: false }).limit(1).maybeSingle().then(r => r.data)
  if (!app) return null

  const path = `intake/${app.id}/board_approval_letter/${crypto.randomUUID()}.pdf`
  const up = await supabaseAdmin.storage.from('application-docs').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (up.error) return null
  await supabaseAdmin.from('application_documents').delete().eq('application_id', app.id).eq('doc_key', 'board_approval_letter').is('stakeholder_id', null)
  await supabaseAdmin.from('application_documents').insert({
    application_id: app.id, listing_id: app.listing_id, kind: 'other', doc_key: 'board_approval_letter', doc_label: 'Board Approval Letter',
    storage_path: path, filename: 'Board_Approval_Letter.pdf', suggested_name: 'Board_Approval_Letter.pdf',
    mime_type: 'application/pdf', uploaded_by_role: 'esign',
  })

  // Send the signed letter to every party (applicant, owner, agents, signers,
  // on-site manager, PMI) — all BCC'd. Best-effort; never blocks the filing.
  const { distributeApprovalLetter } = await import('@/lib/approval-distribution')
  await distributeApprovalLetter({ doc: fresh, applicationId: String(app.id), pdf }).catch(() => null)

  return String(app.id)
}
