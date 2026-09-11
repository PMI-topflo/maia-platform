// =====================================================================
// lib/stakeholder-merge.ts
//
// Fold one application_stakeholders row into another that is the SAME
// person, then delete the duplicate. Everything that hangs off the old row
// moves to the kept one first, so nothing is orphaned:
//   - application_documents.stakeholder_id  (the per-applicant uploads; the
//     FK is ON DELETE SET NULL, which would silently turn "her driver's
//     license" into an unowned shared file)
//   - screening_subjects.stakeholder_id     (the Checkr subject; the FK has
//     no ON DELETE, so a plain delete FAILS on 23503 — and the applicants
//     route used to swallow that, leaving the duplicate card on the page)
//   - listing_applications.na_items         (`docKey#stakeholderId` scope keys)
//   - the person's own answers / score, when the kept row has none
//
// Real case, MANXI 903 (2026-09-11): "Shoodlyne Deus" twice on one
// application, documents on one row, the payment/Checkr on the other; staff
// pressed Remove + Save and both cards stayed.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

const CARRY = ['vehicle_has', 'vehicle_declared_at', 'tax_returns_has', 'tax_returns_declared_at', 'credit_score',
  'email', 'phone', 'email_verified_at', 'signed_at', 'signature_image', 'checklist_ack_signed_at', 'rules_ack_name', 'rules_ack_ip'] as const

export async function mergeStakeholderInto(applicationId: string, fromId: string, intoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fromId === intoId) return { ok: true }
  const now = new Date().toISOString()

  const { data } = await supabaseAdmin.from('application_stakeholders')
    .select('*').eq('application_id', applicationId).in('id', [fromId, intoId])
  const rows = (data ?? []) as Record<string, unknown>[]
  const from = rows.find(r => String(r.id) === fromId)
  const into = rows.find(r => String(r.id) === intoId)
  if (!from || !into) return { ok: false, error: 'stakeholder rows not found' }

  // 1. Whatever the kept row is missing, take from the duplicate.
  const patch: Record<string, unknown> = {}
  for (const k of CARRY) if ((into[k] == null || into[k] === '') && from[k] != null && from[k] !== '') patch[k] = from[k]
  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from('application_stakeholders').update({ ...patch, updated_at: now }).eq('id', intoId)
    if (error) return { ok: false, error: error.message }
  }

  // 2. Re-point everything keyed by the duplicate's id.
  const d1 = await supabaseAdmin.from('application_documents').update({ stakeholder_id: intoId }).eq('application_id', applicationId).eq('stakeholder_id', fromId)
  if (d1.error) return { ok: false, error: d1.error.message }
  const d2 = await supabaseAdmin.from('screening_subjects').update({ stakeholder_id: intoId }).eq('stakeholder_id', fromId)
  if (d2.error) return { ok: false, error: d2.error.message }

  const { data: app } = await supabaseAdmin.from('listing_applications').select('na_items').eq('id', applicationId).maybeSingle()
  const na = Array.isArray(app?.na_items) ? (app!.na_items as unknown[]).map(String) : []
  if (na.some(k => k.endsWith(`#${fromId}`))) {
    const next = [...new Set(na.map(k => k.endsWith(`#${fromId}`) ? k.slice(0, -fromId.length) + intoId : k))]
    await supabaseAdmin.from('listing_applications').update({ na_items: next, updated_at: now }).eq('id', applicationId)
  }

  // 3. Now the duplicate row can go.
  const { error } = await supabaseAdmin.from('application_stakeholders').delete().eq('id', fromId).eq('application_id', applicationId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
