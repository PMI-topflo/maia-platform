// POST /api/admin/documents/drive/test-write  { folderUrl }
// Verifies MAIA's Drive access to a folder before we build the organize/rename
// tool on top of it. Reports WHO the Drive client is acting as (the impersonated
// user when GOOGLE_DRIVE_IMPERSONATE is set, else the raw service account), then
// does a harmless create → rename → delete of a throwaway folder to confirm
// write/rename/delete actually work. Nothing is left behind. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { extractFolderId, shareTargetEmail } from '@/lib/drive-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { folderUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const folderId = extractFolderId(body.folderUrl ?? '')
  if (!folderId) return NextResponse.json({ error: 'Paste a Drive folder link to test.' }, { status: 400 })

  const drive = getDrive()
  const steps: string[] = []
  let actingAs: string | null = null

  try {
    // Who are we acting as? (impersonated user, or the raw SA)
    const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' })
    actingAs = about.data.user?.emailAddress ?? null
    steps.push(`acting as ${actingAs ?? 'unknown'}`)

    // Create a throwaway folder in the target folder.
    const created = await drive.files.create({
      requestBody: { name: `_MAIA write test ${Date.now()}`, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] },
      fields: 'id', supportsAllDrives: true,
    })
    const testId = created.data.id!
    steps.push('create ✓')

    // Rename it.
    await drive.files.update({ fileId: testId, requestBody: { name: `_MAIA write test ${Date.now()} (renamed)` }, supportsAllDrives: true })
    steps.push('rename ✓')

    // Delete it (clean up — leaves nothing behind).
    await drive.files.delete({ fileId: testId, supportsAllDrives: true })
    steps.push('delete ✓')

    return NextResponse.json({ ok: true, actingAs, folderId, steps, message: `Full write access confirmed as ${actingAs}.` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({
      ok: false, actingAs, folderId, steps,
      shareTarget: shareTargetEmail(),
      error: `Write test failed after [${steps.join(', ') || 'no steps'}]: ${msg}`,
    }, { status: 200 })   // 200 so the client shows the diagnostic, not a generic failure
  }
}
