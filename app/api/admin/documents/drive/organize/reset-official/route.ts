// POST /api/admin/documents/drive/organize/reset-official   { apply }
// Reset the Official Files folder so it can be rebuilt to match MAIA exactly.
// Dry-run (apply=false) counts the current direct-child subfolders. Apply
// creates a dated "Pre-2026-cleanup <date>" bucket inside the OLD/archive
// folder and MOVES every current Official subfolder into it — nothing is
// deleted, so it's fully recoverable. After this, the approval-move step
// rebuilds Official from only the current signed approvals.
// Runs as the SA (impersonating PMI). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { DRIVE_FOLDERS } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FOLDER_MIME = 'application/vnd.google-apps.folder'

async function listOfficialSubfolders(): Promise<{ id: string; name: string }[]> {
  const drive = getDrive()
  const out: { id: string; name: string }[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `'${DRIVE_FOLDERS.official}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id, name)', pageSize: 1000,
      supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken,
    })
    for (const f of res.data.files ?? []) if (f.id) out.push({ id: f.id, name: f.name ?? '' })
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { apply?: boolean }
  try { body = await req.json() } catch { body = {} }
  const apply = body.apply === true

  try {
    const subs = await listOfficialSubfolders()
    if (!apply) {
      return NextResponse.json({ ok: true, apply: false, count: subs.length, sample: subs.slice(0, 6).map(s => s.name) })
    }
    if (subs.length === 0) return NextResponse.json({ ok: true, apply: true, moved: 0, bucket: null, message: 'Official is already empty.' })

    const drive = getDrive()
    const label = `Pre-2026-cleanup ${new Date().toISOString().slice(0, 10)}`
    // Reuse an existing bucket with the same label if a prior run made one.
    const existing = await drive.files.list({
      q: `'${DRIVE_FOLDERS.archive}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name = '${label}'`,
      fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true,
    })
    let bucketId = existing.data.files?.[0]?.id ?? null
    if (!bucketId) {
      const made = await drive.files.create({
        requestBody: { name: label, mimeType: FOLDER_MIME, parents: [DRIVE_FOLDERS.archive] },
        fields: 'id', supportsAllDrives: true,
      })
      bucketId = made.data.id ?? null
    }
    if (!bucketId) return NextResponse.json({ error: 'Could not create the cleanup bucket.' }, { status: 200 })

    let moved = 0
    for (const s of subs) {
      try {
        await drive.files.update({ fileId: s.id, addParents: bucketId, removeParents: DRIVE_FOLDERS.official, fields: 'id', supportsAllDrives: true })
        moved++
      } catch { /* skip a stubborn folder, keep going */ }
    }
    return NextResponse.json({ ok: true, apply: true, moved, total: subs.length, bucket: label })
  } catch (e) {
    return NextResponse.json({ error: `Reset failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
