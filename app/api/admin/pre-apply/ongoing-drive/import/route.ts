// POST /api/admin/pre-apply/ongoing-drive/import   { unitRef, folderId?, folderUrl?, type? }
// "Bring into MAIA": create an application record for a unit that already has a
// folder in the On Going Applications Drive folder but no in-app record yet, and
// link it to that existing Drive folder — so it becomes trackable in the
// pipeline (scan/upload docs, review, board-approve). Staff-only. Idempotent:
// if the unit already has an open application, returns it instead of duplicating.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { isApplicationType } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const digits = (s: string) => s.replace(/\D/g, '')

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: { unitRef?: string; folderId?: string; folderUrl?: string; type?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const unitNo = digits(String(b.unitRef ?? ''))
  if (!unitNo) return NextResponse.json({ error: 'a unit reference is required' }, { status: 400 })
  const type = isApplicationType(String(b.type ?? '')) ? String(b.type) : 'lease'
  const assoc = 'MANXI'

  // Idempotent: reuse an existing open application for this unit.
  const { data: existing } = await supabaseAdmin.from('listing_applications')
    .select('id, unit_label').eq('association_code', assoc).in('status', ['started', 'submitted', 'under_review', 'approved'])
  const hit = (existing ?? []).find(a => digits(String(a.unit_label ?? '')) === unitNo)
  if (hit) return NextResponse.json({ ok: true, applicationId: String(hit.id), existed: true })

  const now = new Date().toISOString()
  const { data: listing, error: le } = await supabaseAdmin.from('unit_listings').insert({
    association_code: assoc, unit_label: unitNo, listing_type: type === 'purchase' ? 'sale' : 'rent', status: 'open', created_by_role: 'staff',
  }).select('id').single()
  if (le || !listing) return NextResponse.json({ error: `could not create: ${le?.message ?? 'unknown'}` }, { status: 500 })

  const { data: app, error: ae } = await supabaseAdmin.from('listing_applications').insert({
    listing_id: listing.id, association_code: assoc, unit_label: unitNo, application_type: type,
    applicant_role: 'applicant', status: 'submitted', submitted_at: now, created_by_role: 'staff',
    drive_folder_id: String(b.folderId ?? '') || null, drive_folder_url: String(b.folderUrl ?? '') || null,
  }).select('id').single()
  if (ae || !app) return NextResponse.json({ error: `could not create: ${ae?.message ?? 'unknown'}` }, { status: 500 })

  return NextResponse.json({ ok: true, applicationId: String(app.id), existed: false })
}
