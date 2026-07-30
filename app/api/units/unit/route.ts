// GET /api/units/unit?account=MANXI604[&assoc=CODE]
// Full record for one unit for the audit portal: owner/occupancy/tenant,
// required-vs-on-file docs, balance + collections, and pending manager
// upload submissions.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildAssociationAudit } from '@/lib/association-audit'
import { listCurrentBalances } from '@/lib/integrations/cinc'
import { isAccountInCollections } from '@/lib/owner-ledger-flow'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { signOwnerComplianceToken } from '@/lib/owner-portal-token'
import { getTenantComplianceState } from '@/lib/unit-required-docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const account = (url.searchParams.get('account') || '').trim()
  const auth = await resolveUnitsAuth(url.searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })

  if (auth.managedUnits && !auth.managedUnits.includes(account)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const audit = await buildAssociationAudit(auth.assoc)
  const unit = audit.find(u => u.accountNumber.toUpperCase() === account.toUpperCase())
  if (!unit) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

  const [balances, inCollections, subs, assocRow, ownerRows, tenantRow] = await Promise.all([
    listCurrentBalances(auth.assoc).catch(() => new Map<string, number>()),
    isAccountInCollections(auth.assoc, account).catch(() => false),   // ORs collections-list + Block-Payments toggle
    supabaseAdmin.from('unit_document_submissions')
      .select('id, item_key, scope, filename, storage_key, submitted_by_persona, submitted_by_name, ai_verdict, ai_identified_as, ai_expiration_date, ai_summary, status, reviewed_by, reviewed_at, review_note, created_at')
      .eq('association_code', auth.assoc).eq('unit_ref', account).order('created_at', { ascending: false }),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', auth.assoc).maybeSingle(),
    // Full owner contact (CINC-synced): one row per co-owner on the account.
    supabaseAdmin.from('owners')
      .select('first_name, last_name, entity_name, emails, phone, phone_2')
      .eq('association_code', auth.assoc).eq('account_number', account)
      .or('status.neq.previous,status.is.null'),
    // Staff/owner-editable tenant record (also populated from a read lease) —
    // shown for staff to confirm.
    supabaseAdmin.from('unit_tenant_contacts')
      .select('tenant_name, tenant_phone, tenant_email, lease_start, lease_end, updated_by, updated_at')
      .eq('association_code', auth.assoc).eq('unit_ref', account).maybeSingle(),
  ])

  // Build a de-duplicated contact block: each co-owner (name + their phones/
  // emails). emails is a comma-joined string in the owners table.
  const contacts: { name: string; phones: string[]; emails: string[] }[] = []
  for (const r of (ownerRows.data ?? [])) {
    const name = (r.entity_name || [r.first_name, r.last_name].filter(Boolean).join(' ')).trim()
    if (!name && !r.phone && !r.emails) continue
    const phones = [r.phone, r.phone_2].filter(Boolean).map(String)
    const emails = String(r.emails ?? '').split(',').map(s => s.trim()).filter(Boolean)
    contacts.push({ name: name || '—', phones, emails })
  }
  const ownerEmail = contacts.flatMap(c => c.emails)[0] ?? null

  // Owner self-service page (confirm occupancy → owner-occupied/leased/vacant,
  // enter tenant info if leased, upload docs). Preview link for staff/board +
  // the address the "email owner" button would send to.
  const ownerPreviewPath = `/owner/compliance/${await signOwnerComplianceToken(auth.assoc, account)}`

  // Tenant documents (only meaningful when leased) — lets the manager upload
  // tenant files too. Reuses the tenant-compliance required set.
  const tenantMissing = unit.occupancy === 'leased'
    ? (await getTenantComplianceState(auth.assoc, account).catch(() => ({ missing: [] }))).missing.map(m => ({ key: m.key, label: m.label }))
    : []

  return NextResponse.json({
    associationCode: auth.assoc,
    associationName: assocRow.data?.association_name ?? auth.assoc,
    persona:         auth.persona,
    canUpload:       auth.canUpload,
    canReview:       auth.canReview,
    unit: {
      ...unit,
      balance:       balances.get(account.toUpperCase()) ?? null,
      inCollections,
    },
    contacts,
    ownerEmail,
    ownerPreviewPath,
    tenantMissing,
    tenantRecord: tenantRow.data ?? null,
    submissions: subs.data ?? [],
  })
}
