// POST /api/admin/documents/drive/organize/move-to-year  { fileId, parentId, year }
// Move a file into a YEAR subfolder under its unit folder (MANXI###/2023/…),
// creating the year folder if needed. Used by the archive reorg, executed in
// chunks by the client for progress. Runs as the SA (impersonating PMI).
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { resolveDatedSubfolder } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { fileId?: string; parentId?: string; year?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const fileId = String(body.fileId ?? '').trim()
  const parentId = String(body.parentId ?? '').trim()
  const year = String(body.year ?? '').trim()
  if (!fileId || !parentId || !/^\d{4}$/.test(year)) return NextResponse.json({ error: 'fileId, parentId, 4-digit year required' }, { status: 400 })

  try {
    const yearFolderId = await resolveDatedSubfolder(parentId, year, true)
    if (!yearFolderId) return NextResponse.json({ error: 'could not create year subfolder' }, { status: 200 })

    const drive = getDrive()
    const meta = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true })
    const removeParents = (meta.data.parents ?? []).join(',')
    await drive.files.update({ fileId, addParents: yearFolderId, removeParents: removeParents || undefined, supportsAllDrives: true })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: `Move failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
