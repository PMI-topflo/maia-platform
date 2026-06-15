// =====================================================================
// POST /api/admin/invoices/intake/upload   (staff-only)
//
// Manual invoice upload. Staff drops a PDF / photo on the /admin/invoices
// page (or uses "Add invoice" from an association). Each file is run
// through the SAME pipeline as email intake — Claude extraction, CINC
// vendor fuzzy-match, duplicate pre-check — and lands as a draft in the
// review queue. multipart/form-data: field "file" (one or many), optional
// "assoc" to pre-tag the association.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { createManualInvoiceDraft } from '@/lib/invoice-intake'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 25 * 1024 * 1024   // CINC's hard attachment limit
const ACCEPTED = /\.(pdf|jpe?g|png|heic|heif|webp)$/i

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 }) }

  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return NextResponse.json({ error: 'no file uploaded' }, { status: 400 })

  const assoc = (form.get('assoc') as string | null)?.trim().toUpperCase() || null

  const results: { filename: string; ok: boolean; status: string; draftId?: number; reason?: string }[] = []
  for (const file of files) {
    if (file.size > MAX_BYTES) { results.push({ filename: file.name, ok: false, status: 'error', reason: 'over 25 MB' }); continue }
    if (!ACCEPTED.test(file.name)) { results.push({ filename: file.name, ok: false, status: 'error', reason: 'not a PDF or image' }); continue }
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const r = await createManualInvoiceDraft({ buf, filename: file.name, associationCode: assoc })
      results.push({ filename: file.name, ...r })
    } catch (err) {
      results.push({ filename: file.name, ok: false, status: 'error', reason: err instanceof Error ? err.message : String(err) })
    }
  }

  const created = results.filter(r => r.ok).length
  return NextResponse.json({ created, total: files.length, results })
}
