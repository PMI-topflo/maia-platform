// POST /api/admin/documents/drive/organize/reorg-archive  { folderUrl }
// PLAN the reorganization of the "OLD Approved Application Files" archive:
//   • rename each "Unit ###[ note]" folder → "MANXI###[ note]"
//   • move each file into a YEAR subfolder (MANXI###/2023/…) using the year
//     parsed from the filename ("2023 to 2024 Lease.pdf" → 2023).
// Returns the plan only — the client executes it in chunks (rename + move) so
// it can show progress. Runs as the SA (impersonating PMI). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { extractFolderId } from '@/lib/drive-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// "Unit 301 Estoppel" (+ year 2023) → "MANXI301 2023 Estoppel";
// "Unit1008" (+ 2024) → "MANXI1008 2024"; no year → "MANXI1008".
function toManxiName(name: string, year: string | null): string | null {
  const m = name.match(/^\s*unit\s*0*(\d+)\s*(.*)$/i)
  if (!m) return null
  const rest = m[2].trim()
  return ['MANXI' + m[1], year || '', rest].filter(Boolean).join(' ')
}
// First 4-digit year (19xx/20xx) in a filename.
function yearFrom(name: string): string | null {
  const m = name.match(/\b(19|20)\d{2}\b/)
  return m ? m[0] : null
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { folderUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const rootId = extractFolderId(body.folderUrl ?? '')
  if (!rootId) return NextResponse.json({ error: 'Paste the archive folder link.' }, { status: 400 })

  const drive = getDrive()
  try {
    // Top-level unit folders.
    const unitFolders: { id: string; name: string }[] = []
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'nextPageToken, files(id, name)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken,
      })
      for (const f of res.data.files ?? []) if (f.id) unitFolders.push({ id: f.id, name: f.name ?? '' })
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    // Direct files in each unit folder → year move plan (skip nested
    // subfolders), and the folder's representative year = the LATEST year seen.
    const fileMoves: { id: string; name: string; parentId: string; year: string }[] = []
    const folderYear = new Map<string, string>()
    let undated = 0
    await Promise.all(unitFolders.map(async uf => {
      let pt: string | undefined
      do {
        const res = await drive.files.list({
          q: `'${uf.id}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
          fields: 'nextPageToken, files(id, name)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken: pt,
        })
        for (const f of res.data.files ?? []) {
          if (!f.id) continue
          const year = yearFrom(f.name ?? '')
          if (year) {
            fileMoves.push({ id: f.id, name: f.name ?? '', parentId: uf.id, year })
            const prev = folderYear.get(uf.id)
            if (!prev || year > prev) folderYear.set(uf.id, year)   // latest year wins
          } else undated++
        }
        pt = res.data.nextPageToken ?? undefined
      } while (pt)
    }))

    // Rename each unit folder → MANXI### <year> <note>.
    const folderRenames: { id: string; oldName: string; newName: string }[] = []
    for (const uf of unitFolders) {
      const newName = toManxiName(uf.name, folderYear.get(uf.id) ?? null)
      if (newName && newName !== uf.name) folderRenames.push({ id: uf.id, oldName: uf.name, newName })
    }

    return NextResponse.json({
      ok: true,
      unitFolders: unitFolders.length,
      folderRenames, fileMoves,
      counts: { renames: folderRenames.length, moves: fileMoves.length, undated },
      sampleRenames: folderRenames.slice(0, 8).map(r => `${r.oldName} → ${r.newName}`),
    })
  } catch (e) {
    return NextResponse.json({ error: `Archive scan failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
