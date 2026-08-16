// =====================================================================
// lib/occupant-sponsorship.ts
//
// The sitting tenant sponsors an additional occupant.
//
// THE RULE THIS FILE EXISTS FOR: the occupant's email is REQUIRED and must be
// DIFFERENT from the tenant's, and from anyone else already on the
// application.
//
// MANXI 1003 is why. The additional occupant's paperwork carried the tenant's
// email address. MAIA treats email as identity — it is what the OTP verifies
// and what an electronic signature is attributed to — so the occupant's
// affidavit would have been sent to her mailbox, verified against her mailbox,
// and recorded as signed by him. The board would be relying on a signature
// that only proves somebody with access to HER email signed it.
//
// A responsibility acknowledgment does not fix that. It allocates blame after
// the fact; it does not make a signature attributable. Hence: a separate
// address, enforced on the server, not merely requested in the form.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export const norm = (e: unknown) => String(e ?? '').trim().toLowerCase()

/** The tenant's own responsibility, in the association's own terms. This is
 *  not a new liability MAIA invents — the governing documents already make the
 *  tenant answerable for their occupants, guests and invitees. */
export const SPONSOR_ACKNOWLEDGMENT =
  'I am asking the Association to add this person as an occupant of my unit. ' +
  'I understand that, under the Association’s governing documents, I remain responsible for this occupant’s ' +
  'compliance with the Rules and Regulations, and for any damage or violation arising from their occupancy, ' +
  'for as long as they reside in the unit. The contact details I have given are this person’s own.'

export type SponsorshipCheck = { ok: true; email: string } | { ok: false; error: string }

/** Validate the occupant's address against everyone already on the record.
 *  Returns the normalised address, or the reason it was refused. */
export async function checkOccupantEmail(opts: {
  applicationId: string
  tenantEmail: string
  candidate: unknown
}): Promise<SponsorshipCheck> {
  const email = norm(opts.candidate)
  if (!email || !email.includes('@') || email.length < 5) {
    return { ok: false, error: 'Please enter the occupant’s own email address.' }
  }
  if (email === norm(opts.tenantEmail)) {
    return {
      ok: false,
      error: 'That is your own email address. The occupant needs their own — MAIA sends them their forms to sign, ' +
        'and a signature has to be verified against the signer’s own mailbox, not yours.',
    }
  }
  // Anyone else already on this application, so two occupants can't share one
  // address either.
  const { data: others } = await supabaseAdmin.from('application_stakeholders')
    .select('name, email').eq('application_id', opts.applicationId)
  const clash = (others ?? []).find(o => norm(o.email) === email)
  if (clash) {
    return {
      ok: false,
      error: `That address is already used by ${String(clash.name ?? 'somebody else')} on this application. Each person needs their own.`,
    }
  }
  return { ok: true, email }
}

export interface CurrentLease {
  tenantName: string | null
  tenantEmail: string | null
  tenantPhone: string | null
  leaseStart: string | null
  leaseEnd: string | null
  approvedAt: string | null
  approvedApplicationId: string | null
  documents: { docKey: string; label: string; url: string }[]
}

/** What is already true about this unit, for the header of an additional-
 *  occupant application.
 *
 *  SHOWN, NOT COPIED. Duplicating the approved lease onto the occupant's
 *  application produced two copies that drift apart, a second PDF in Drive,
 *  and — worst — a carried expiration that then reads as THIS application's
 *  expired document. The occupant's card links through to the approved
 *  application's own copy instead. */
export async function getCurrentLease(associationCode: string, unitLabel: string | null): Promise<CurrentLease | null> {
  const unit = (unitLabel ?? '').trim()
  if (!unit) return null
  const code = associationCode.toUpperCase()

  const [{ data: apps }, { data: tc }] = await Promise.all([
    supabaseAdmin.from('listing_applications')
      .select('id, unit_label, application_type, status, reviewed_at, updated_at')
      .eq('association_code', code).eq('unit_label', unit)
      .in('application_type', ['lease', 'purchase', 'lease_renewal']).eq('status', 'approved')
      .order('reviewed_at', { ascending: false }),
    supabaseAdmin.from('unit_tenant_contacts')
      .select('tenant_name, tenant_email, tenant_phone, lease_start, lease_end')
      .eq('association_code', code).eq('unit_ref', unit).maybeSingle(),
  ])
  const src = (apps ?? [])[0]
  if (!src && !tc) return null

  let documents: CurrentLease['documents'] = []
  if (src) {
    const { data: docs } = await supabaseAdmin.from('application_documents')
      .select('id, doc_key, doc_label').eq('application_id', src.id)
    documents = (docs ?? [])
      .filter(d => d.doc_key)
      .map(d => ({
        docKey: String(d.doc_key), label: String(d.doc_label ?? d.doc_key),
        url: `/api/admin/pre-apply/${src.id}/doc/${d.id}`,
      }))
  }

  return {
    tenantName: (tc?.tenant_name as string | null) ?? null,
    tenantEmail: (tc?.tenant_email as string | null) ?? null,
    tenantPhone: (tc?.tenant_phone as string | null) ?? null,
    leaseStart: (tc?.lease_start as string | null) ?? null,
    leaseEnd: (tc?.lease_end as string | null) ?? null,
    approvedAt: src ? String(src.reviewed_at ?? src.updated_at ?? '') || null : null,
    approvedApplicationId: src ? String(src.id) : null,
    documents,
  }
}
