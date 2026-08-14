// GET  /api/admin/drive-folders?code=VPCI&folderId=...   → the rename plan
// POST /api/admin/drive-folders  { code, folderId }      → apply it
//
// Renames an association's per-unit Drive folders to "ACCOUNT_ADDRESS". Plan
// first, always — the GET never touches Drive beyond listing. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { planUnitFolderRenames } from '@/lib/assoc-folder-rename'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FOLDER_ID = /^[A-Za-z0-9_-]{10,}$/

/** Accepts a bare id or a pasted Drive URL. */
function parseFolderId(raw: string): string | null {
  const s = raw.trim()
  const fromUrl = /\/folders\/([A-Za-z0-9_-]+)/.exec(s)?.[1]
  const id = fromUrl ?? s
  return FOLDER_ID.test(id) ? id : null
}

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const code = (url.searchParams.get('code') ?? '').trim().toUpperCase()
  const folderId = parseFolderId(url.searchParams.get('folderId') ?? '')
  if (!code) return NextResponse.json({ error: 'association code required' }, { status: 400 })
  if (!folderId) return NextResponse.json({ error: 'a Drive folder id or URL is required' }, { status: 400 })
  return NextResponse.json(await planUnitFolderRenames({ associationCode: code, rootFolderId: folderId }))
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let b: { code?: string; folderId?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const code = (b.code ?? '').trim().toUpperCase()
  const folderId = parseFolderId(b.folderId ?? '')
  if (!code) return NextResponse.json({ error: 'association code required' }, { status: 400 })
  if (!folderId) return NextResponse.json({ error: 'a Drive folder id or URL is required' }, { status: 400 })
  return NextResponse.json(await planUnitFolderRenames({ associationCode: code, rootFolderId: folderId, apply: true }))
}
