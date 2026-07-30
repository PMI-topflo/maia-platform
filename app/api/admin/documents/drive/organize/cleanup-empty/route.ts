// POST /api/admin/documents/drive/organize/cleanup-empty
//   { folderUrl, apply, markUnits }
// Find (apply=false) or delete (apply=true) recursively-EMPTY subfolders under
// a folder — e.g. the redundant category subfolders (Insurance / Lauderhill
// Certificate of Use / …) left inside each MANXI### unit folder.
//
// With markUnits, the DIRECT child unit folders that are (now) totally empty
// get " - NO FILES YET" appended to their name so you can see which units have
// no documents; folders that DO have files get that tag stripped (self-heal).
// Copy → Official also strips the tag when a file lands (NO_FILES_TAG).
//
// Safety:
//   • A folder counts as empty only if its ENTIRE subtree has no files.
//   • The folder you point at, and its DIRECT children (the unit folders),
//     are NEVER deleted — only empty folders at depth ≥ 2.
//   • Deletes the top of each empty subtree (its empty descendants go with it).
//   • apply=false returns the list without touching anything (preview first).
// Runs as the SA (impersonating PMI). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { extractFolderId } from '@/lib/drive-import'
import { NO_FILES_TAG, stripNoFilesTag } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface Node { id: string; name: string; parentId: string; depth: number; hasDirectFiles: boolean; childFolderIds: string[] }

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { folderUrl?: string; apply?: boolean; markUnits?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const rootId = extractFolderId(body.folderUrl ?? '')
  if (!rootId) return NextResponse.json({ error: 'Paste a Drive folder link.' }, { status: 400 })
  const apply = body.apply === true
  const markUnits = body.markUnits === true

  const drive = getDrive()
  const nodes = new Map<string, Node>()

  try {
    // BFS: list every folder under root, recording whether it directly holds
    // any files + its child folders. Bounded concurrency per level.
    let frontier: { id: string; depth: number; parentId: string }[] = [{ id: rootId, depth: 0, parentId: '' }]
    let guard = 0
    while (frontier.length && guard < 20000) {
      const next: { id: string; depth: number; parentId: string }[] = []
      for (let i = 0; i < frontier.length; i += 12) {
        const slice = frontier.slice(i, i + 12)
        guard += slice.length
        await Promise.all(slice.map(async ({ id, depth, parentId }) => {
          let hasDirectFiles = false
          const childFolderIds: string[] = []
          let pageToken: string | undefined
          do {
            const res = await drive.files.list({
              q: `'${id}' in parents and trashed = false`,
              fields: 'nextPageToken, files(id, name, mimeType)',
              pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken,
            })
            for (const f of res.data.files ?? []) {
              if (f.mimeType === FOLDER_MIME) { childFolderIds.push(f.id!); next.push({ id: f.id!, depth: depth + 1, parentId: id }) }
              else hasDirectFiles = true
            }
            pageToken = res.data.nextPageToken ?? undefined
          } while (pageToken)
          // Names aren't needed for every node — only for deletion candidates,
          // fetched below — so leave name blank here.
          if (depth > 0) nodes.set(id, { id, name: '', parentId, depth, hasDirectFiles, childFolderIds })
        }))
      }
      frontier = next
    }

    const emptyMemo = new Map<string, boolean>()
    function isEmpty(id: string): boolean {
      const n = nodes.get(id); if (!n) return true
      if (emptyMemo.has(id)) return emptyMemo.get(id)!
      const empty = !n.hasDirectFiles && n.childFolderIds.every(cid => isEmpty(cid))
      emptyMemo.set(id, empty); return empty
    }

    // Delete the TOP of each empty subtree: an empty folder (depth ≥ 2) whose
    // parent is NOT itself empty (parent has files, or is a preserved unit
    // folder at depth 1).
    const candidates: Node[] = []
    for (const n of nodes.values()) {
      if (n.depth < 2) continue
      if (!isEmpty(n.id)) continue
      const parentEmpty = nodes.has(n.parentId) && isEmpty(n.parentId)
      if (!parentEmpty) candidates.push(n)
    }

    // Fill names for the candidates.
    await Promise.all(candidates.map(async c => {
      try { const m = await drive.files.get({ fileId: c.id, fields: 'name', supportsAllDrives: true }); c.name = m.data.name ?? '(folder)' } catch { c.name = '(folder)' }
    }))

    let deleted = 0
    const failed: string[] = []
    if (apply) {
      for (const c of candidates) {
        try { await drive.files.delete({ fileId: c.id, supportsAllDrives: true }); deleted++ }
        catch (e) { failed.push(`${c.name}: ${e instanceof Error ? e.message : 'failed'}`) }
      }
    }

    // Mark / unmark the direct child unit folders: empty ones get " - NO FILES
    // YET"; ones with files get it stripped. (Emptiness reflects the deletions
    // above.)
    let marked = 0, unmarked = 0
    if (markUnits) {
      const depth1 = [...nodes.values()].filter(n => n.depth === 1)
      await Promise.all(depth1.map(async n => {
        try {
          const m = await drive.files.get({ fileId: n.id, fields: 'name', supportsAllDrives: true })
          const name = m.data.name ?? ''
          const tagged = /-\s*NO FILES YET\s*$/i.test(name)
          if (isEmpty(n.id) && !tagged) {
            await drive.files.update({ fileId: n.id, requestBody: { name: `${stripNoFilesTag(name)}${NO_FILES_TAG}` }, supportsAllDrives: true }); marked++
          } else if (!isEmpty(n.id) && tagged) {
            await drive.files.update({ fileId: n.id, requestBody: { name: stripNoFilesTag(name) }, supportsAllDrives: true }); unmarked++
          }
        } catch { /* skip this one */ }
      }))
    }

    return NextResponse.json({
      ok: true, foldersScanned: nodes.size, emptyCount: candidates.length,
      applied: apply, deleted, failed: failed.slice(0, 10),
      markedEmptyUnits: marked, unmarkedUnits: unmarked,
      sample: candidates.slice(0, 40).map(c => c.name),
    })
  } catch (e) {
    return NextResponse.json({ error: `Cleanup failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
