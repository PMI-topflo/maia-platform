// =====================================================================
// POST /api/admin/documents/drive/scan  { folderUrl }
// Lists the importable files (PDFs/images) under a shared Google Drive
// folder, recursively, with their subfolder breadcrumb. Also returns the
// service-account email so the UI can tell staff who to share the folder
// with. Staff-only. The actual import is one file at a time via /drive/import.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { extractFolderId, listFolderFilesRecursive, shareTargetEmail } from '@/lib/drive-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { folderUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const sa = shareTargetEmail()
  const folderId = extractFolderId(body.folderUrl ?? '')
  if (!folderId) return NextResponse.json({ error: 'Could not read a Drive folder link. Paste the folder URL.', serviceAccountEmail: sa }, { status: 400 })

  try {
    const { files, foldersScanned } = await listFolderFilesRecursive(folderId)
    return NextResponse.json({ serviceAccountEmail: sa, folderId, count: files.length, foldersScanned, files })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /not found|404|permission|insufficient/i.test(msg) && sa
      ? ` — make sure the folder is shared with ${sa} (Viewer is enough).`
      : ''
    return NextResponse.json({ error: `Couldn't read that folder: ${msg}${hint}`, serviceAccountEmail: sa }, { status: 502 })
  }
}
