// POST /api/admin/documents/drive/organize/ongoing-plan
// Plan the reorganization of the "On Going Applications" tree: for each unit
// folder, propose MANXI### + a YYYY_MM_<first applicant> subfolder + per-file
// renames (reads one doc per unit for the applicant name + lease start).
// Returns the plan only — the client applies per unit for progress. Runs as
// the SA (impersonating PMI). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { extractFolderId } from '@/lib/drive-import'
import { scanOngoingUnits, planOngoingUnit, loadKnownUnitRefs } from '@/lib/drive-ongoing'
import { DRIVE_FOLDERS } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { folderUrl?: string } = {}
  try { body = await req.json() } catch { /* optional body */ }
  const rootId = body.folderUrl ? (extractFolderId(body.folderUrl) ?? DRIVE_FOLDERS.ongoing) : DRIVE_FOLDERS.ongoing

  try {
    const [units, knownRefs] = await Promise.all([scanOngoingUnits(rootId), loadKnownUnitRefs('MANXI')])
    const plans = []
    for (const u of units) plans.push(await planOngoingUnit(u, knownRefs))
    return NextResponse.json({ ok: true, count: plans.length, units: plans })
  } catch (e) {
    return NextResponse.json({ error: `Plan failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
