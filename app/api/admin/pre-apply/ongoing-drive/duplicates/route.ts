// GET /api/admin/pre-apply/ongoing-drive/duplicates?assoc=MANXI
// POST /api/admin/pre-apply/ongoing-drive/duplicates   { survivorFolderId, loserFolderId }
//
// Two folders for the same unit under "On Going Applications" — one bare
// "MANXI613" (or already renamed "MANXI613 — Type — Names"), one legacy
// "Unit 613 - Name" — left behind by ensureOngoingUnitFolder's old naming
// (fixed 2026-08-19, see lib/drive-application-mirror.ts). Found live for
// units 103 and 912. GET previews every duplicate group; nothing changes
// until POST is called for a specific pair, and only after staff confirms
// which folder survives. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { findDuplicateOngoingFolders, mergeOngoingDuplicateFolder } from '@/lib/drive-application-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const assoc = new URL(req.url).searchParams.get('assoc')?.trim().toUpperCase() || 'MANXI'
  const res = await findDuplicateOngoingFolders(assoc)
  return NextResponse.json(res)
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { survivorFolderId?: string; loserFolderId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const survivorFolderId = String(b.survivorFolderId ?? '').trim()
  const loserFolderId = String(b.loserFolderId ?? '').trim()
  if (!survivorFolderId || !loserFolderId) return NextResponse.json({ error: 'survivorFolderId and loserFolderId are required' }, { status: 400 })
  const res = await mergeOngoingDuplicateFolder({ survivorFolderId, loserFolderId })
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'merge failed' }, { status: 200 })
  return NextResponse.json(res)
}
