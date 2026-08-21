// =====================================================================
// lib/document-request-email.ts
//
// Sends the standard "documents needed" email for a document_requests row.
// One place, because there are now TWO moments a request goes out:
//   1. staff click "Request documents" (the owner side, and the tenant side
//      when we already have a tenant address), and
//   2. later, automatically, when the owner fills in the tenant roster — the
//      tenant items were held back until we had somebody to send them to.
// Both must produce the identical email, so neither rebuilds it by hand.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { renderMaiaEmail } from '@/lib/maia-email'
import { getIntakeChecklist, isApplicationType } from '@/lib/intake-documents'
import { INTAKE_BUCKET } from '@/lib/preapply'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SUPPORT = 'support@topfloridaproperties.com'
const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease Renewal', additional_occupant: 'Additional Occupant' }

export interface RequestItem { doc_key: string; label: string; recipient: 'owner' | 'tenant' | 'both' }

export const splitEmails = (raw: string | null | undefined) =>
  [...new Set((raw ?? '').split(',').map(s => s.trim()).filter(e => e.includes('@')))]

export interface SendRequestResult { sentOwner: boolean; sentTenant: boolean }

/** Send the request email(s) for one document_requests row. `only` restricts to
 *  a single side — used when the tenant half is released later. A side is sent
 *  only when it has both a token and at least one address. */
export async function sendDocumentRequestEmails(requestId: string, opts?: { only?: 'owner' | 'tenant' }): Promise<SendRequestResult> {
  const out: SendRequestResult = { sentOwner: false, sentTenant: false }

  const { data: reqRow } = await supabaseAdmin.from('document_requests')
    .select('id, application_id, association_code, unit_label, items, message, owner_token, tenant_token, owner_email, tenant_email')
    .eq('id', requestId).maybeSingle()
  if (!reqRow) return out

  const id = String(reqRow.application_id)
  const code = String(reqRow.association_code)
  const unit = (reqRow.unit_label as string | null) ?? null
  const items = (Array.isArray(reqRow.items) ? reqRow.items : []) as RequestItem[]

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('application_type').eq('id', id).maybeSingle()

  const [{ data: assoc }, { data: applicants }, { data: onFileDocs }, { data: agents }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }),
    supabaseAdmin.from('application_documents').select('doc_key, doc_label, expiration_date, no_expiration, created_at').eq('application_id', id).order('created_at', { ascending: true }),
    supabaseAdmin.from('application_stakeholders').select('role, email').eq('application_id', id).in('role', ['listing_agent', 'applicant_agent']),
  ])

  // "Already on file" — one per checklist item, with expiration context.
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const seen = new Set<string>()
  const onFile = (onFileDocs ?? []).filter(d => { const k = String(d.doc_key ?? Math.random()); if (seen.has(k)) return false; seen.add(k); return true }).map(d => {
    const exp = d.no_expiration ? null : (d.expiration_date as string | null)
    const expired = !!(exp && new Date(exp) < new Date())
    return { label: String(d.doc_label ?? 'Document'), note: d.no_expiration ? 'does not expire' : exp ? `${expired ? 'expired' : 'expires'} ${fmtDate(exp)}` : null, expired }
  })

  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const address = [assoc?.principal_address, unit ? `Unit ${unit}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  const applicantNames = (applicants ?? []).map(a => String(a.name ?? '').trim()).filter(Boolean)
  const typeLabel = TYPE_LABEL[String(app?.application_type)] ?? String(app?.application_type ?? '')

  // "Please send me an example of this document you want" was the most common
  // reply to this email, so every requested item now carries the checklist's
  // own clarifier AND a link to a real example where the association has one
  // on file. The template was already used on the upload page; it had simply
  // never made it into the email that asks for the document.
  const type = String(app?.application_type ?? '')
  const checklist = isApplicationType(type) ? await getIntakeChecklist(code, type) : []
  const byKey = new Map(checklist.map(c => [c.doc_key, c]))
  const exampleUrls = new Map<string, string>()
  await Promise.all([...new Set(items.map(i => i.doc_key))].map(async k => {
    const path = byKey.get(k)?.template_path
    if (!path) return
    // Long-lived on purpose: an owner may open the email days after it lands.
    const { data } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30)
    if (data?.signedUrl) exampleUrls.set(k, data.signedUrl)
  }))
  // A REFUSED document is being asked for again, and the applicant is owed the
  // reason. Without this the same email goes out twice and the second one looks
  // identical to the first — which is exactly how "your application is
  // incomplete" reads to somebody who thought they had already sent it.
  const { data: refusals } = await supabaseAdmin.from('application_document_reviews')
    .select('doc_key, decision, reason, decided_by')
    .eq('application_id', id).eq('decision', 'refused')
    .then(r => r, () => ({ data: [] as unknown[] }))
  const refusedBy = new Map(((refusals ?? []) as { doc_key: string; reason: string | null; decided_by: string }[])
    .filter(r => (r.reason ?? '').trim())
    .map(r => [r.doc_key, { reason: String(r.reason), by: String(r.decided_by) }]))

  const decorate = (i: RequestItem, whoFor: string) => {
    const refused = refusedBy.get(i.doc_key)
    const note = byKey.get(i.doc_key)?.note ?? null
    return {
      label: i.label, whoFor,
      // The reason leads: it is the new information, and the generic clarifier
      // is what they already read the first time.
      note: refused ? `Sent back by ${refused.by}: ${refused.reason}${note ? ` · ${note}` : ''}` : note,
      exampleUrl: exampleUrls.get(i.doc_key) ?? null,
    }
  }

  const ownerAgentCc = splitEmails((agents ?? []).find(a => a.role === 'listing_agent')?.email as string | null)
  const tenantAgentCc = splitEmails((agents ?? []).find(a => a.role === 'applicant_agent')?.email as string | null)

  const ownerItems = items.filter(i => i.recipient === 'owner' || i.recipient === 'both')
  const tenantItems = items.filter(i => i.recipient === 'tenant' || i.recipient === 'both')
  const ownerEmails = splitEmails(reqRow.owner_email as string | null)
  const tenantEmails = splitEmails(reqRow.tenant_email as string | null)
  const ownerToken = reqRow.owner_token as string | null
  const tenantToken = reqRow.tenant_token as string | null

  const heading = `Documents needed for your ${typeLabel.toLowerCase()}`
  const intro = (reqRow.message as string | null)?.trim() || `We're almost done with your ${typeLabel.toLowerCase()}. Please upload the items below — it takes about a minute and doesn't require a login.`
  const subject = `${heading} — ${unit ? `Unit ${unit}` : legal}`

  if (opts?.only !== 'tenant' && ownerToken && ownerEmails.length && ownerItems.length) {
    await sendEmail({ to: ownerEmails, cc: ownerAgentCc.length ? ownerAgentCc : undefined, replyTo: SUPPORT, subject,
      html: renderMaiaEmail({ associationName: legal, associationCode: code, unit, propertyAddress: address, applicantNames, applicationType: typeLabel, heading, intro,
        items: ownerItems.map(i => decorate(i, i.recipient === 'both' ? 'You + Tenant' : 'You')), onFile,
        alsoRequested: tenantItems.length ? { who: 'the tenant', items: tenantItems.map(i => i.label) } : null,
        ctaUrl: `${APP}/request/${ownerToken}`, footerReason: `You're receiving this as the owner of ${unit ? `Unit ${unit}` : 'this unit'}.` }),
    }).then(() => { out.sentOwner = true }, () => null)
  }

  if (opts?.only !== 'owner' && tenantToken && tenantEmails.length && tenantItems.length) {
    await sendEmail({ to: tenantEmails, cc: tenantAgentCc.length ? tenantAgentCc : undefined, replyTo: SUPPORT, subject,
      html: renderMaiaEmail({ associationName: legal, associationCode: code, unit, propertyAddress: address, applicantNames, applicationType: typeLabel, heading, intro,
        items: tenantItems.map(i => decorate(i, i.recipient === 'both' ? 'You + Owner' : 'You')), onFile,
        alsoRequested: ownerItems.length ? { who: 'the owner', items: ownerItems.map(i => i.label) } : null,
        ctaUrl: `${APP}/request/${tenantToken}`, footerReason: `You're receiving this because you're on the application for ${unit ? `Unit ${unit}` : 'this unit'}.` }),
    }).then(() => { out.sentTenant = true }, () => null)
  }

  return out
}
