// POST /api/admin/pre-apply/[id]/meta   { application_type?, applicant_name? }
// Edit an application's type (new lease / lease renewal / purchase / additional
// occupant) and the applicant's name — the latter creates/updates the primary
// applicant stakeholder (imported/Drive-only apps have none, so the name shows
// as "—" until set here). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isApplicationType, getIntakeChecklist, type ApplicationType } from '@/lib/intake-documents'
import { getDrive } from '@/lib/drive-invoice-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = { lease: 'New Lease', lease_renewal: 'Lease Renewal', purchase: 'Purchase', additional_occupant: 'Additional Occupant' }

// Rename the application's On Going Drive folder to flag the type + applicant,
// keeping the "<ASSOC>###" prefix so folder parsing still works. Best-effort.
async function flagDriveFolder(appId: string): Promise<void> {
  try {
    const { data: a } = await supabaseAdmin.from('listing_applications')
      .select('association_code, unit_label, application_type, drive_folder_id').eq('id', appId).maybeSingle()
    const fid = String(a?.drive_folder_id ?? '')
    if (!fid) return
    const unitRef = `${String(a?.association_code ?? '').toUpperCase()}${String(a?.unit_label ?? '').replace(/\D/g, '')}`
    const { data: sh } = await supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', appId).eq('is_primary', true).maybeSingle()
    const label = TYPE_LABEL[String(a?.application_type ?? '')] ?? String(a?.application_type ?? '')
    const name = [unitRef, label, (sh?.name as string | null)?.trim()].filter(Boolean).join(' — ').replace(/[\\/:*?"<>|]+/g, ' ')
    if (name) await getDrive().files.update({ fileId: fid, requestBody: { name }, supportsAllDrives: true })
  } catch { /* prod-only Drive; never fails the save */ }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id, status').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let b: { application_type?: string; applicant_name?: string; confirmApproved?: boolean }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // An APPROVED application is the tenant/buyer of record for the unit, so
  // changing its type or applicant rewrites that record in place — which is how
  // 1003 once became "Rushayne Shaw · Additional occupant" by accident.
  //
  // But a flat block was the wrong remedy. An application filed under the wrong
  // TYPE still carries its uploaded documents and its signed board approval
  // letter, and "start a new one" throws all of that away to fix a dropdown.
  // So the change is CONFIRMED rather than forbidden: staff acknowledge they
  // are rewriting an approved record, and the change is recorded on the audit
  // note so it is never a silent edit.
  const touchesRecord = (typeof b.application_type === 'string' && b.application_type.trim()) || typeof b.applicant_name === 'string'
  if (app.status === 'approved' && touchesRecord && !b.confirmApproved) {
    return NextResponse.json({
      error: 'This application is already APPROVED — it is the record of who the board approved for this unit. Changing its type or applicant rewrites that record in place. Confirm to proceed, or start a new application from the unit\'s Pre-Application link if this is a separate request.',
      needsConfirm: true,
    }, { status: 409 })
  }
  if (app.status === 'approved' && touchesRecord && b.confirmApproved) {
    const stamp = `[${new Date().toISOString().slice(0, 10)}] Approved record edited by ${session.displayName}: ${[
      typeof b.application_type === 'string' && b.application_type.trim() ? `type → ${b.application_type.trim()}` : null,
      typeof b.applicant_name === 'string' ? `applicant → ${b.applicant_name.trim() || '(cleared)'}` : null,
    ].filter(Boolean).join(', ')}`
    const { data: cur } = await supabaseAdmin.from('listing_applications').select('review_note').eq('id', id).maybeSingle()
    await supabaseAdmin.from('listing_applications')
      .update({ review_note: [(cur?.review_note as string | null) ?? '', stamp].filter(Boolean).join('\n') })
      .eq('id', id)
  }

  // Documents already imported under the OLD type that the NEW type doesn't ask
  // for (e.g. a lease scanned in before the app was switched to Purchase). They
  // stay on the record — staff decide — but we report them so nobody is surprised
  // by a stray "expired lease" on a purchase.
  const staleDocs: string[] = []
  if (typeof b.application_type === 'string' && b.application_type.trim()) {
    const nextType = b.application_type.trim()
    if (!isApplicationType(nextType)) return NextResponse.json({ error: 'invalid application type' }, { status: 400 })
    await supabaseAdmin.from('listing_applications').update({ application_type: nextType, updated_at: new Date().toISOString() }).eq('id', id)

    const { data: appRow } = await supabaseAdmin.from('listing_applications').select('association_code').eq('id', id).maybeSingle()
    const checklist = await getIntakeChecklist(String(appRow?.association_code ?? ''), nextType as ApplicationType)
    const keys = new Set(checklist.map(c => c.doc_key))
    const { data: docs } = await supabaseAdmin.from('application_documents').select('doc_key, doc_label').eq('application_id', id)
    for (const d of docs ?? []) if (d.doc_key && !keys.has(String(d.doc_key))) staleDocs.push(String(d.doc_label ?? d.doc_key))
  }

  if (typeof b.applicant_name === 'string') {
    const name = b.applicant_name.trim()
    const { data: primary } = await supabaseAdmin.from('application_stakeholders')
      .select('id').eq('application_id', id).eq('is_primary', true).maybeSingle()
    if (primary) {
      await supabaseAdmin.from('application_stakeholders').update({ name: name || null, updated_at: new Date().toISOString() }).eq('id', primary.id)
    } else if (name) {
      await supabaseAdmin.from('application_stakeholders').insert({
        application_id: id, role: 'applicant', name, is_primary: true, status: 'active', added_by_role: 'staff',
      })
    }
  }

  await flagDriveFolder(id)
  return NextResponse.json({ ok: true, staleDocs })
}
