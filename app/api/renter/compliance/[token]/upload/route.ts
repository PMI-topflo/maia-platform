// =====================================================================
// POST /api/renter/compliance/[token]/upload   (multipart: files[])
// A tenant uploads their documents (HO-4, registrations, etc.). Each is
// staged and run through the MAIA intake pipeline tagged with the unit,
// landing in the staff review queue. Token-gated (no session).
// =====================================================================

import { NextResponse } from 'next/server'
import { verifyTenantComplianceToken } from '@/lib/owner-portal-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ingestStagedDocument } from '@/lib/document-intake-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'association-documents'
const MAX_FILES = 12
const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const t = await verifyTenantComplianceToken(token)
  if (!t) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return NextResponse.json({ error: 'no files' }, { status: 400 })
  if (files.length > MAX_FILES) return NextResponse.json({ error: `max ${MAX_FILES} files at once` }, { status: 400 })

  const hint = `Tenant document for unit ${t.account}, association ${t.assoc} — tenant-uploaded (renters insurance / registrations / etc.)`
  let saved = 0
  const failed: string[] = []
  for (const f of files) {
    if (!ALLOWED.test(f.name)) { failed.push(`${f.name} (type)`); continue }
    const buf = Buffer.from(await f.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) { failed.push(`${f.name} (over 25 MB)`); continue }
    const safe = f.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
    const path = `_inbox/tenant-${t.account}-${Date.now()}-${safe}${/\.(pdf|jpe?g|png|heic|webp)$/i.test(safe) ? '' : '.pdf'}`
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: f.type || 'application/pdf', upsert: true })
    if (up.error) { failed.push(`${f.name} (${up.error.message})`); continue }
    const res = await ingestStagedDocument({ storagePath: path, filename: f.name, mimeType: f.type || 'application/pdf', uploadedBy: `tenant:${t.account}`, contextHint: hint })
    if (res.ok) saved++; else failed.push(`${f.name} (${res.error})`)
  }
  if (saved === 0) return NextResponse.json({ error: `nothing uploaded. ${failed.join('; ')}` }, { status: 400 })
  return NextResponse.json({ ok: true, saved, failed: failed.length })
}
