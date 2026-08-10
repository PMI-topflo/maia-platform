// POST /api/admin/pre-apply/[id]/meta   { application_type?, applicant_name? }
// Edit an application's type (new lease / lease renewal / purchase / additional
// occupant) and the applicant's name — the latter creates/updates the primary
// applicant stakeholder (imported/Drive-only apps have none, so the name shows
// as "—" until set here). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isApplicationType } from '@/lib/intake-documents'
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
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id, status').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let b: { application_type?: string; applicant_name?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Guard: an APPROVED application is the tenant/buyer of record for the unit.
  // Changing its type or applicant here would overwrite that record in place
  // (this is how unit 1003 got turned into "Rushayne Shaw · Additional occupant").
  // To add an occupant or file a different application, start a NEW one from the
  // unit's Pre-Application link instead.
  if (app.status === 'approved' && ((typeof b.application_type === 'string' && b.application_type.trim()) || typeof b.applicant_name === 'string')) {
    return NextResponse.json({
      error: 'This application is already approved — its type and applicant are locked so the approved record isn\'t overwritten. To add an occupant or file another application for this unit, start a new one from the unit\'s Pre-Application link.',
    }, { status: 409 })
  }

  if (typeof b.application_type === 'string' && b.application_type.trim()) {
    if (!isApplicationType(b.application_type.trim())) return NextResponse.json({ error: 'invalid application type' }, { status: 400 })
    await supabaseAdmin.from('listing_applications').update({ application_type: b.application_type.trim(), updated_at: new Date().toISOString() }).eq('id', id)
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
  return NextResponse.json({ ok: true })
}
