// POST /api/admin/documents/drive/organize/rename  { fileId, newName }
// Rename a Drive file in place (the file-organize screen). Runs as the SA
// (impersonating PMI). Staff-only. Returns the new name on success.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fileId?: string; newName?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const fileId = String(body.fileId ?? '').trim()
  const newName = String(body.newName ?? '').trim()
  if (!fileId || !newName) return NextResponse.json({ error: 'fileId and newName required' }, { status: 400 })
  // Guard against path separators / control chars in a filename.
  if (/[\/\\\x00-\x1f]/.test(newName)) return NextResponse.json({ error: 'invalid characters in name' }, { status: 400 })

  try {
    const drive = getDrive()
    await drive.files.update({ fileId, requestBody: { name: newName }, supportsAllDrives: true })
    return NextResponse.json({ ok: true, name: newName })
  } catch (e) {
    return NextResponse.json({ error: `Rename failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
