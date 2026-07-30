// POST /api/admin/documents/drive/organize/delete-folders  { ids: string[] }
// Permanently delete a batch of (empty) folders. Called in chunks by the
// organize screen so the UI can show progress. Each folder is deleted by
// whichever identity OWNS it: the redundant category subfolders are owned by
// the service account (impersonated-PMI can't delete those), so we try the
// raw SA first, then fall back to the impersonated (PMI) client. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive, getDriveAsServiceAccount } from '@/lib/drive-invoice-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string').slice(0, 100) : []
  if (ids.length === 0) return NextResponse.json({ ok: true, deleted: 0, failed: [] })

  const sa = getDriveAsServiceAccount()
  const pmi = getDrive()
  let deleted = 0
  const failed: string[] = []

  await Promise.all(ids.map(async id => {
    try {
      await sa.files.delete({ fileId: id, supportsAllDrives: true }); deleted++
    } catch {
      try { await pmi.files.delete({ fileId: id, supportsAllDrives: true }); deleted++ }
      catch (e2) { failed.push(`${id}: ${e2 instanceof Error ? e2.message : 'failed'}`) }
    }
  }))

  return NextResponse.json({ ok: true, deleted, failed: failed.slice(0, 10) })
}
