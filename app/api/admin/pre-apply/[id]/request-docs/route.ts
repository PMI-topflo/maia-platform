// POST /api/admin/pre-apply/[id]/request-docs
//   { items: [{ doc_key, label, recipient: 'owner'|'tenant'|'both' }], message? }
// Create a document request and email the owner and/or tenant the standard MAIA
// email with a secure upload link (per-recipient token). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'
import { renderMaiaEmail } from '@/lib/maia-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.pmitop.com'
const SUPPORT = 'support@topfloridaproperties.com'
const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease Renewal', additional_occupant: 'Additional Occupant' }
const firstEmail = (raw: string | null) => (raw ?? '').split(',').map(s => s.trim()).find(e => e.includes('@')) ?? null

type Recipient = 'owner' | 'tenant' | 'both'
interface Item { doc_key: string; label: string; recipient: Recipient }

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let b: { items?: unknown; message?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const items: Item[] = Array.isArray(b.items) ? (b.items as unknown[]).map(x => {
    const o = (x ?? {}) as Record<string, unknown>
    const rec = String(o.recipient ?? 'owner')
    return { doc_key: String(o.doc_key ?? '').trim(), label: String(o.label ?? '').trim(), recipient: (rec === 'tenant' || rec === 'both' ? rec : 'owner') as Recipient }
  }).filter(i => i.doc_key && i.label) : []
  if (items.length === 0) return NextResponse.json({ error: 'Select at least one document to request.' }, { status: 400 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, unit_label, application_type').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const code = String(app.association_code)
  const unit = (app.unit_label as string | null) ?? null

  // Context for the standard email.
  const [{ data: assoc }, { data: applicants }, { data: owners }, { data: tenant }] = await Promise.all([
    supabaseAdmin.from('associations').select('legal_name, association_name, principal_address, city, state, zip').eq('association_code', code).maybeSingle(),
    supabaseAdmin.from('application_stakeholders').select('name, email, is_primary').eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }),
    supabaseAdmin.from('owners').select('emails, unit_number, account_number, status').eq('association_code', code).or('status.neq.previous,status.is.null'),
    supabaseAdmin.from('unit_tenant_contacts').select('tenant_email').eq('association_code', code).eq('unit_ref', unit ?? '').maybeSingle(),
  ])
  const legal = (assoc?.legal_name as string | null) || (assoc?.association_name as string | null) || code
  const address = [assoc?.principal_address, unit ? `Unit ${unit}` : null, [assoc?.city, [assoc?.state, assoc?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') || null
  const applicantNames = (applicants ?? []).map(a => String(a.name ?? '').trim()).filter(Boolean)
  const typeLabel = TYPE_LABEL[String(app.application_type)] ?? String(app.application_type)

  const ownerEmail = firstEmail(((owners ?? []).find(o => String(o.unit_number ?? '') === (unit ?? '') || String(o.account_number ?? '') === (unit ?? ''))?.emails as string | null) ?? (owners ?? [])[0]?.emails as string | null ?? null)
  const tenantEmail = (tenant?.tenant_email as string | null) || firstEmail((applicants ?? []).find(a => a.is_primary)?.email as string | null ?? (applicants ?? [])[0]?.email as string | null ?? null)

  const ownerItems = items.filter(i => i.recipient === 'owner' || i.recipient === 'both')
  const tenantItems = items.filter(i => i.recipient === 'tenant' || i.recipient === 'both')
  const ownerToken = ownerItems.length && ownerEmail ? crypto.randomUUID() : null
  const tenantToken = tenantItems.length && tenantEmail ? crypto.randomUUID() : null

  const { data: created, error } = await supabaseAdmin.from('document_requests').insert({
    application_id: id, association_code: code, unit_label: unit, items,
    message: (b.message ?? '').trim() || null, owner_token: ownerToken, tenant_token: tenantToken,
    owner_email: ownerEmail, tenant_email: tenantEmail, created_by: `staff:${session.displayName}`,
  }).select('id').single()
  if (error || !created) return NextResponse.json({ error: `Could not create request: ${error?.message ?? 'unknown'}` }, { status: 500 })

  const heading = `Documents needed for your ${typeLabel.toLowerCase()}`
  const intro = (b.message ?? '').trim() || `We're almost done with your ${typeLabel.toLowerCase()}. Please upload the items below — it takes about a minute and doesn't require a login.`

  let sentOwner = false, sentTenant = false
  if (ownerToken && ownerEmail) {
    await sendEmail({ to: [ownerEmail], replyTo: SUPPORT, subject: `${heading} — ${unit ? `Unit ${unit}` : legal}`,
      html: renderMaiaEmail({ associationName: legal, associationCode: code, propertyAddress: address, applicantNames, applicationType: typeLabel, heading, intro,
        items: ownerItems.map(i => ({ label: i.label, whoFor: i.recipient === 'both' ? 'You + Tenant' : 'You' })),
        ctaUrl: `${APP}/request/${ownerToken}`, footerReason: `You're receiving this as the owner of ${unit ? `Unit ${unit}` : 'this unit'}.` }),
    }).then(() => { sentOwner = true }, () => null)
  }
  if (tenantToken && tenantEmail) {
    await sendEmail({ to: [tenantEmail], replyTo: SUPPORT, subject: `${heading} — ${unit ? `Unit ${unit}` : legal}`,
      html: renderMaiaEmail({ associationName: legal, associationCode: code, propertyAddress: address, applicantNames, applicationType: typeLabel, heading, intro,
        items: tenantItems.map(i => ({ label: i.label, whoFor: i.recipient === 'both' ? 'You + Owner' : 'You' })),
        ctaUrl: `${APP}/request/${tenantToken}`, footerReason: `You're receiving this because you're on the application for ${unit ? `Unit ${unit}` : 'this unit'}.` }),
    }).then(() => { sentTenant = true }, () => null)
  }

  return NextResponse.json({
    ok: true, requestId: created.id,
    ownerEmail: ownerToken ? ownerEmail : null, tenantEmail: tenantToken ? tenantEmail : null,
    sentOwner, sentTenant,
    warnings: [
      ownerItems.length && !ownerEmail ? 'No owner email on file — owner items were not sent.' : null,
      tenantItems.length && !tenantEmail ? 'No tenant email on file — tenant items were not sent.' : null,
    ].filter(Boolean),
  })
}
