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
import { computeFormExpiry } from '@/lib/esign-forms'

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
}

const COLS = 'id, kind, association_code, unit_ref, title, payload, signers, status, compliance_item, created_at'

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
  if (complete && doc.kind === 'board_decision' && doc.unit_ref) {
    await fileBoardApprovalLetter(id).catch(() => null)
  }

  return { ok: true, status, complete }
}

async function fileBoardApprovalLetter(esignDocId: string): Promise<void> {
  const fresh = await getEsignDoc(esignDocId)
  if (!fresh || !fresh.unit_ref) return
  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { renderFormPdf } = await import('@/lib/esign-forms')
  const el = renderFormPdf(fresh)
  if (!el) return
  const pdf = Buffer.from(await renderToBuffer(el))

  // The most recent in-process (or just-approved) application for this unit.
  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, listing_id').eq('association_code', fresh.association_code).eq('unit_label', fresh.unit_ref)
    .in('status', ['started', 'submitted', 'under_review', 'approved']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!app) return

  const path = `intake/${app.id}/board_approval_letter/${crypto.randomUUID()}.pdf`
  const up = await supabaseAdmin.storage.from('application-docs').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (up.error) return
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
}
