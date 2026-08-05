// GET /api/admin/pre-apply  → the Applications command center: every open
// application (started / submitted / under_review) plus recently decided ones,
// with applicant, unit, type, stage, document count, and the On Going Drive
// folder. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('id, association_code, application_type, unit_label, status, submitted_at, created_at, drive_folder_url, rules_ack')
    .in('status', ['started', 'submitted', 'under_review', 'approved', 'declined'])
    .order('created_at', { ascending: false })
    .limit(300)

  const ids = (apps ?? []).map(a => a.id)
  const [{ data: sh }, { data: docs }] = await Promise.all([
    ids.length ? supabaseAdmin.from('application_stakeholders').select('application_id, name, email, is_primary').eq('is_primary', true).in('application_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? supabaseAdmin.from('application_documents').select('application_id').in('application_id', ids) : Promise.resolve({ data: [] }),
  ])
  const nameByApp = new Map((sh ?? []).map(s => [s.application_id, { name: s.name as string | null, email: s.email as string | null }]))
  const docCount = new Map<string, number>()
  for (const d of docs ?? []) docCount.set(d.application_id as string, (docCount.get(d.application_id as string) ?? 0) + 1)

  return NextResponse.json({
    applications: (apps ?? []).map(a => ({
      id: a.id, associationCode: a.association_code, type: a.application_type, unit: a.unit_label,
      status: a.status, submittedAt: a.submitted_at, startedAt: a.created_at, driveFolderUrl: a.drive_folder_url,
      applicant: nameByApp.get(a.id) ?? null, docCount: docCount.get(a.id) ?? 0,
      signed: !!(a.rules_ack as { name?: string } | null)?.name,
    })),
  })
}
