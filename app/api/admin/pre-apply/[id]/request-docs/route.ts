// POST /api/admin/pre-apply/[id]/request-docs
//   { items: [{ doc_key, label, recipient: 'owner'|'tenant'|'both' }], message? }
// Create a document request and email the owner and/or tenant the standard MAIA
// email with a secure upload link (per-recipient token). Staff-only.
//
// SOME ITEMS ARE NOT UPLOADS. The Rules Knowledge Acknowledgment, the Animal
// Information form and the Emergency Contact List are documents MAIA GENERATES
// and the resident e-signs. Ticking one used to send an upload link asking
// somebody to upload a document that does not exist until we make it — there
// was literally nothing for them to attach. Those items are now split out and
// sent as the form itself; everything else still gets the upload link.
// See lib/application-esign-forms.ts for the list.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendDocumentRequestEmails, splitEmails } from '@/lib/document-request-email'
import { isEsignItem, sendEsignFormsForItems, ESIGN_CHECKLIST_ITEMS } from '@/lib/application-esign-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Recipient = 'owner' | 'tenant' | 'both'
interface Item { doc_key: string; label: string; recipient: Recipient }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { items?: unknown; message?: string; ownerEmail?: string; tenantEmail?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const items: Item[] = Array.isArray(b.items) ? (b.items as unknown[]).map(x => {
    const o = (x ?? {}) as Record<string, unknown>
    const rec = String(o.recipient ?? 'owner')
    return { doc_key: String(o.doc_key ?? '').trim(), label: String(o.label ?? '').trim(), recipient: (rec === 'tenant' || rec === 'both' ? rec : 'owner') as Recipient }
  }).filter(i => i.doc_key && i.label) : []
  if (items.length === 0) return NextResponse.json({ error: 'Select at least one document to request.' }, { status: 400 })

  // Forms MAIA generates go out as the form; the rest as an upload request.
  const formItems = items.filter(i => isEsignItem(i.doc_key))
  const uploadItems = items.filter(i => !isEsignItem(i.doc_key))

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, application_type').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? null

  const [{ data: applicants }, { data: owners }, { data: tenant }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('email, is_primary').eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }),
    supabaseAdmin.from('owners').select('emails, unit_number, account_number, status').eq('association_code', code).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_email').eq('association_code', code).eq('unit_ref', unit ?? '').maybeSingle(),
  ])

  // Owner emails: a staff override wins; else EVERY email on the matched owner
  // record (owners often carry several — don't silently pick just the first).
  // EVERY owner row for the unit, not the first: a co-owned unit has one row
  // per owner, and picking one silently dropped the other's address.
  const ownerRows = (owners ?? []).filter(o => String(o.unit_number ?? '') === (unit ?? '') || String(o.account_number ?? '') === (unit ?? '') || String(o.account_number ?? '').toUpperCase() === `${code}${unit ?? ''}`.toUpperCase())
  const ownerOverride = splitEmails(b.ownerEmail)
  const ownerEmails = ownerOverride.length ? ownerOverride : splitEmails(ownerRows.map(o => String(o.emails ?? '')).join(','))
  const tenantOverride = splitEmails(b.tenantEmail)
  const tenantEmails = tenantOverride.length ? tenantOverride : splitEmails((tenant?.tenant_email as string | null) || ((applicants ?? []).find(a => a.is_primary)?.email as string | null) || ((applicants ?? [])[0]?.email as string | null))

  const ownerItems = uploadItems.filter(i => i.recipient === 'owner' || i.recipient === 'both')
  const tenantItems = uploadItems.filter(i => i.recipient === 'tenant' || i.recipient === 'both')
  const ownerToken = ownerItems.length && ownerEmails.length ? crypto.randomUUID() : null
  // No tenant address yet is NOT a dead end: if we're asking the owner for the
  // roster on this same request, the tenant half is HELD and goes out by itself
  // the moment the owner supplies the names and emails.
  const tenantToken = tenantItems.length && tenantEmails.length ? crypto.randomUUID() : null
  const askingForRoster = ownerItems.some(i => i.doc_key === 'tenant_contact_info')
  const tenantHeld = tenantItems.length > 0 && !tenantEmails.length && askingForRoster

  // Send the generated forms first — they go straight to the person who signs
  // them, not through the upload-request token.
  const forms = formItems.length
    ? await sendEsignFormsForItems(id, formItems.map(i => i.doc_key), `staff:${session.displayName}`)
    : { sent: [], failed: [] }

  // Nothing left to upload: no request row, and no email telling somebody to
  // upload nothing.
  if (uploadItems.length === 0) {
    return NextResponse.json({
      ok: true, requestId: null,
      ownerEmail: null, tenantEmail: null, sentOwner: false, sentTenant: false, tenantHeld: false,
      formsSent: forms.sent.map(f => ({ noun: ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey, name: f.name, email: f.email })),
      warnings: forms.failed.map(f => `${ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey} was not sent — ${f.reason}.`),
    })
  }

  const { data: created, error } = await supabaseAdmin.from('document_requests').insert({
    application_id: id, association_code: code, unit_label: unit, items: uploadItems,
    message: (b.message ?? '').trim() || null, owner_token: ownerToken, tenant_token: tenantToken,
    owner_email: ownerEmails.join(', ') || null, tenant_email: tenantEmails.join(', ') || null, created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create request: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const { sentOwner, sentTenant } = await sendDocumentRequestEmails(String(created.id))

  return NextResponse.json({
    ok: true, requestId: created.id,
    ownerEmail: ownerToken ? ownerEmails.join(', ') : null, tenantEmail: tenantToken ? tenantEmails.join(', ') : null,
    sentOwner, sentTenant, tenantHeld,
    formsSent: forms.sent.map(f => ({ noun: ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey, name: f.name, email: f.email })),
    warnings: [
      ownerItems.length && !ownerEmails.length ? 'No owner email on file — owner items were not sent.' : null,
      tenantItems.length && !tenantEmails.length && !askingForRoster ? 'No tenant email on file — tenant items were not sent. Tick “Tenant names, emails & phone numbers” and send it to the owner to collect them.' : null,
      ...forms.failed.map(f => `${ESIGN_CHECKLIST_ITEMS[f.docKey]?.noun ?? f.docKey} was not sent — ${f.reason}.`),
    ].filter(Boolean),
  })
}
