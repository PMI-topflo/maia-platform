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
import { requiredRoles } from '@/lib/esign-forms'

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

  const roles = requiredRoles(doc.kind)
  const complete = roles.length > 0 && roles.every(r => roleSigned(after, r))
  const status: EsignStatus = complete ? 'completed' : 'partially_signed'
  await supabaseAdmin.from('esign_documents').update({ status, updated_at: now }).eq('id', id)

  if (complete && doc.compliance_item && doc.unit_ref) {
    await supabaseAdmin.from('compliance_records').upsert({
      scope: 'unit', association_code: doc.association_code, unit_ref: doc.unit_ref,
      item_key: doc.compliance_item, applicable: true, status: 'current', expiry_date: null,
      updated_by: `system:esign:${doc.kind}`, updated_at: now,
    }, { onConflict: 'scope,association_code,unit_ref,item_key' }).then(() => null, () => null)
  }

  return { ok: true, status, complete }
}
