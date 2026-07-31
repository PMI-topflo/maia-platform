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

// Parse a folder name (either "Unit ###[ note]" or an already-renamed
// "MANXI###[ year][ note]") into its parts, pulling out any year already there.
function parseFolder(name: string): { num: string; note: string; existingYear: string } | null {
  const m = name.match(/^\s*(?:unit|manxi)\s*0*(\d+)\s*(.*)$/i)
  if (!m) return null
  let rest = m[2].trim()
  let existingYear = ''
  const ym = rest.match(/^((?:19|20)\d{2})\b\s*(.*)$/)
  if (ym) { existingYear = ym[1]; rest = ym[2].trim() }
  return { num: m[1], note: rest, existingYear }
}
function buildName(num: string, year: string, note: string): string {
  return ['MANXI' + num, year || '', note].filter(Boolean).join(' ')
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

    // Per folder: gather the direct files (year-move plan) and every year
    // signal — a year in a filename, an existing YEAR subfolder, or the file's
    // created-date year (fallback) — so EVERY folder gets a year.
    const fileMoves: { id: string; name: string; parentId: string; year: string }[] = []
    const folderYear = new Map<string, string>()
    let undated = 0
    await Promise.all(unitFolders.map(async uf => {
      const meaningful: string[] = []   // filename + subfolder years (preferred)
      const created: string[] = []      // file created-date years (fallback)
      let pt: string | undefined
      do {
        const res = await drive.files.list({
          q: `'${uf.id}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, createdTime)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken: pt,
        })
        for (const f of res.data.files ?? []) {
          if (!f.id) continue
          if (f.mimeType === FOLDER_MIME) {
            if (/^(?:19|20)\d{2}$/.test((f.name ?? '').trim())) meaningful.push((f.name ?? '').trim())
            continue
          }
          const fy = yearFrom(f.name ?? '')
          if (fy) { meaningful.push(fy); fileMoves.push({ id: f.id, name: f.name ?? '', parentId: uf.id, year: fy }) }
          else undated++
          if (f.createdTime) created.push(String(new Date(f.createdTime).getUTCFullYear()))
        }
        pt = res.data.nextPageToken ?? undefined
      } while (pt)
      const yr = meaningful.length ? meaningful.sort().at(-1)! : (created.length ? created.sort().at(-1)! : null)
      if (yr) folderYear.set(uf.id, yr)
    }))

    // Rename each folder → MANXI### <year> <note>. Keeps a year that's already
    // there; otherwise adds the derived one. Re-runnable on MANXI### folders.
    const folderRenames: { id: string; oldName: string; newName: string }[] = []
    for (const uf of unitFolders) {
      const p = parseFolder(uf.name)
      if (!p) continue
      const useYear = p.existingYear || (folderYear.get(uf.id) ?? '')
      const newName = buildName(p.num, useYear, p.note)
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
