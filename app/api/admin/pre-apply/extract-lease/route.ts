// POST /api/admin/pre-apply/extract-lease
// Staff-only. Reads a lease document staff is about to attach to a NEW
// application (before it exists) and returns what MAIA can make out of it —
// tenant names, email, phone, lease term — so the "Open an application" form
// can pre-fill the roster from the document instead of staff retyping what's
// already printed on the file they're attaching anyway. User direction,
// 2026-08-27 (a real owner-forwarded "fully executed lease" for a renewal).

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { extractLeaseDetails } from '@/lib/lease-extract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  const d = await extractLeaseDetails(buf, file.type || 'application/pdf')
  return NextResponse.json({ ok: true, ...d })
}
