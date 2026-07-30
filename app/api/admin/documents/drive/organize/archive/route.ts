// POST /api/admin/documents/drive/organize/archive  { fileId, unitRef, dateLabel?, newName? }
// MOVE an application document out of "On Going Applications" into the
// permanent "OLD Approved Application Files" archive, filed under
// MANXI### / <YYYY-MM>. PII lives here for the record and is never imported.
// Runs as the SA. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { DRIVE_FOLDERS, resolveUnitFolder, resolveDatedSubfolder } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fileId?: string; unitRef?: string; dateLabel?: string; newName?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const fileId = String(body.fileId ?? '').trim()
  const unitRef = String(body.unitRef ?? '').trim()
  const dateLabel = (String(body.dateLabel ?? '').trim() || new Date().toISOString().slice(0, 7))   // default YYYY-MM
  if (!fileId || !unitRef) return NextResponse.json({ error: 'fileId and unitRef required' }, { status: 400 })

  try {
    const unitFolderId = await resolveUnitFolder(DRIVE_FOLDERS.archive, unitRef, true)
    if (!unitFolderId) return NextResponse.json({ error: `could not resolve archive folder for ${unitRef}` }, { status: 200 })
    const datedId = await resolveDatedSubfolder(unitFolderId, dateLabel, true)
    if (!datedId) return NextResponse.json({ error: 'could not resolve dated subfolder' }, { status: 200 })

    const drive = getDrive()
    const meta = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true })
    const removeParents = (meta.data.parents ?? []).join(',')
    await drive.files.update({
      fileId, addParents: datedId, removeParents: removeParents || undefined,
      requestBody: body.newName ? { name: String(body.newName).trim() } : {},
      supportsAllDrives: true,
    })
    return NextResponse.json({ ok: true, unitRef, dateLabel })
  } catch (e) {
    return NextResponse.json({ error: `Archive failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
