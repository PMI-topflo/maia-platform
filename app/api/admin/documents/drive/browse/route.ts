// GET /api/admin/documents/drive/browse?parentId=<id|root>
// List the SUBFOLDERS under a Drive folder so staff can navigate the Drive
// from the organize screen and pick a folder to scan (instead of pasting a
// link). Runs as the SA (impersonating PMI). Folders only. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parentId = (new URL(req.url).searchParams.get('parentId') || 'root').trim()

  try {
    const drive = getDrive()

    // The current folder's own name + parent, for the breadcrumb / "up".
    let current: { id: string; name: string; parentId: string | null } | null = null
    if (parentId !== 'root') {
      const meta = await drive.files.get({ fileId: parentId, fields: 'id, name, parents', supportsAllDrives: true })
      current = { id: meta.data.id!, name: meta.data.name ?? '(folder)', parentId: meta.data.parents?.[0] ?? 'root' }
    }

    const folders: { id: string; name: string }[] = []
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        orderBy: 'name', pageSize: 1000,
        supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken,
      })
      for (const f of res.data.files ?? []) if (f.id) folders.push({ id: f.id, name: f.name ?? '(folder)' })
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    return NextResponse.json({ parentId, current, folders })
  } catch (e) {
    return NextResponse.json({ error: `Could not list folders: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
