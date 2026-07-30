// POST /api/admin/documents/drive/organize/copy  { fileId, unitRef, newName }
// Copy a keeper file (renamed) into the unit's folder in the OFFICIAL tree
// ("Unit Docs - 2026 Maia Official Files"). The source is left in place; the
// copy is the clean record MAIA reads. Creates the MANXI### folder if needed.
// Runs as the SA (impersonating PMI). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { DRIVE_FOLDERS, resolveUnitFolder } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fileId?: string; unitRef?: string; newName?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const fileId = String(body.fileId ?? '').trim()
  const unitRef = String(body.unitRef ?? '').trim()
  const newName = String(body.newName ?? '').trim()
  if (!fileId || !unitRef || !newName) return NextResponse.json({ error: 'fileId, unitRef, newName required' }, { status: 400 })
  if (/[\/\\\x00-\x1f]/.test(newName)) return NextResponse.json({ error: 'invalid characters in name' }, { status: 400 })

  try {
    const unitFolderId = await resolveUnitFolder(DRIVE_FOLDERS.official, unitRef, true)
    if (!unitFolderId) return NextResponse.json({ error: `could not resolve official folder for ${unitRef}` }, { status: 200 })

    const drive = getDrive()
    const copied = await drive.files.copy({
      fileId, requestBody: { name: newName, parents: [unitFolderId] },
      fields: 'id, webViewLink', supportsAllDrives: true,
    })
    return NextResponse.json({ ok: true, id: copied.data.id, link: copied.data.webViewLink, unitRef })
  } catch (e) {
    return NextResponse.json({ error: `Copy to Official failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
