// GET /api/admin/pre-apply/ongoing-drive
// Lists the unit folders that physically exist in the "On Going Applications"
// Drive folder — the applications already in process in Drive (many pre-date the
// in-app pipeline, so they have no listing_applications row yet). Cross-references
// each with the DB so staff can see which are tracked in MAIA and which are
// Drive-only. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { scanOngoingUnits, unitRefFromFolder } from '@/lib/drive-ongoing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const digits = (s: string) => s.replace(/\D/g, '')

export async function GET() {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let folders: { id: string; name: string }[]
  try { folders = await scanOngoingUnits() }
  catch (err) { return NextResponse.json({ units: [], error: err instanceof Error ? err.message : String(err) }) }

  // Which unit numbers already have an in-app application (any status)?
  const { data: apps } = await supabaseAdmin.from('listing_applications')
    .select('unit_label, status, id').eq('association_code', 'MANXI')
  const recordByUnit = new Map<string, { id: string; status: string }>()
  for (const a of apps ?? []) {
    const d = digits(String(a.unit_label ?? ''))
    if (d && !recordByUnit.has(d)) recordByUnit.set(d, { id: String(a.id), status: String(a.status) })
  }

  const units = folders
    .map(f => {
      const ref = unitRefFromFolder(f.name) // MANXI###
      const num = ref ? digits(ref) : digits(f.name)
      const rec = num ? recordByUnit.get(num) : undefined
      return {
        folderName: f.name, unitRef: ref, unitNumber: num || null,
        url: `https://drive.google.com/drive/folders/${f.id}`,
        applicationId: rec?.id ?? null, applicationStatus: rec?.status ?? null,
      }
    })
    .sort((a, b) => Number(a.unitNumber ?? 0) - Number(b.unitNumber ?? 0))

  return NextResponse.json({ units })
}
