// POST /api/admin/documents/drive/organize/ongoing-apply
//   { folderId, newFolderName, subfolderName, files: [{ fileId, newName }] }
// Apply one On Going unit's plan: rename the folder → MANXI###, create the
// YYYY_MM_<applicant> subfolder, and move + rename every file into it. Called
// once per unit by the client so it can show progress. Runs as the SA
// (impersonating PMI). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { applyOngoingUnit } from '@/lib/drive-ongoing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { folderId?: string; newFolderName?: string; subfolderName?: string; files?: { fileId?: string; newName?: string }[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const folderId = String(body.folderId ?? '').trim()
  const newFolderName = String(body.newFolderName ?? '').trim()
  const subfolderName = String(body.subfolderName ?? '').trim()   // optional — folder is renamed even without it
  if (!folderId || !newFolderName) {
    return NextResponse.json({ error: 'folderId and newFolderName are required' }, { status: 400 })
  }
  const files = (body.files ?? [])
    .map(f => ({ fileId: String(f.fileId ?? '').trim(), newName: String(f.newName ?? '').trim() }))
    .filter(f => f.fileId && f.newName)

  try {
    const res = await applyOngoingUnit({ folderId, newFolderName, subfolderName, files })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    return NextResponse.json({ error: `Apply failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
