// GET  /api/apply/documents/[id]   — the applicant's own status + doc list
// POST /api/apply/documents/[id]   — add one more document to a PAID
//   application, multipart {file, label?}
//
// Real gap this closes: the OLD /apply wizard (components/ApplicationForm.tsx,
// the `applications` table) has no way for an applicant to add a document
// after paying — previously "solved" by a misleading "@maia upapp" email
// hint that was removed (2026-09-03, Mark Leguizamon incident: MAIA only
// ever stored the attachment FILENAME, never the file itself). This route is
// the real, working replacement: public (id is the token, same convention as
// app/api/rescreen/[token]/route.ts), scoped to ONE application, additive
// only — no other field on the row can be touched through here.
//
// Deliberately NOT built on the newer /pre-apply system (listing_applications
// / application_stakeholders / document_requests) — that schema has several
// invariants (a required unit_listings FK, an intake-checklist relevance
// filter that would silently hide a generic "extra document" item, owner/
// tenant-only UI copy) a synthetic bridge row would fight rather than fit.
// Kept self-contained on the OLD applications table instead.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { INTAKE_BUCKET } from '@/lib/preapply'
import { sendEmail } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED = /\.(pdf|jpe?g|png|heic|webp)$/i
const NOTIFY = (process.env.UNIT_UPLOAD_NOTIFY_EMAILS ?? 'PMI@topfloridaproperties.com,ar@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

// INTAKE_BUCKET is private (every other reader in this codebase signs a URL
// on demand — see lib/document-request-email.ts, lib/intake-documents.ts —
// never getPublicUrl, which would silently 400 on a private bucket). Store
// the storage path only; sign fresh URLs whenever the doc list is read.
interface SupplementalDoc { path: string; filename: string; label: string | null; uploaded_at: string }

async function signDocs(docs: SupplementalDoc[]) {
  return Promise.all(docs.map(async d => {
    const { data } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(d.path, 60 * 60)
    return { filename: d.filename, label: d.label, uploaded_at: d.uploaded_at, url: data?.signedUrl ?? null }
  }))
}

async function loadPaidApplication(id: string) {
  const { data: app } = await supabaseAdmin.from('applications')
    .select('id, association, applicants, stripe_payment_status, supplemental_documents')
    .eq('id', id).maybeSingle()
  if (!app || app.stripe_payment_status !== 'paid') return null
  return app
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const app = await loadPaidApplication(id)
  if (!app) return NextResponse.json({ error: 'This link is invalid, or payment has not been confirmed yet.' }, { status: 404 })

  const applicants = (app.applicants as Array<Record<string, string>> | null) ?? []
  const refNum = 'PMI-' + (app.id as string).slice(0, 8).toUpperCase()
  return NextResponse.json({
    association: app.association, refNum,
    applicantName: applicants[0] ? `${applicants[0].firstName ?? ''} ${applicants[0].lastName ?? ''}`.trim() : null,
    documents: await signDocs((app.supplemental_documents as SupplementalDoc[] | null) ?? []),
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const app = await loadPaidApplication(id)
  if (!app) return NextResponse.json({ error: 'This link is invalid, or payment has not been confirmed yet.' }, { status: 404 })

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'invalid form' }, { status: 400 }) }
  const file = form.get('file')
  const label = String(form.get('label') ?? '').trim().slice(0, 200) || null
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Choose a file first.' }, { status: 400 })
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'Please upload a PDF or image.' }, { status: 400 })
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'File is over 25 MB.' }, { status: 400 })

  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
  const path = `supplemental/${id}/${crypto.randomUUID()}_${safe}`
  const up = await supabaseAdmin.storage.from(INTAKE_BUCKET).upload(path, buf, { contentType: file.type || 'application/pdf' })
  if (up.error) return NextResponse.json({ error: `Upload failed: ${up.error.message}` }, { status: 500 })

  const doc: SupplementalDoc = { path, filename: file.name, label, uploaded_at: new Date().toISOString() }
  const documents = [...((app.supplemental_documents as SupplementalDoc[] | null) ?? []), doc]
  const { error: updErr } = await supabaseAdmin.from('applications').update({ supplemental_documents: documents }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const refNum = 'PMI-' + (app.id as string).slice(0, 8).toUpperCase()
  if (NOTIFY.length) {
    // 30-day link — same duration lib/document-request-email.ts already uses
    // for staff-facing notification emails on this same bucket.
    const { data: signed } = await supabaseAdmin.storage.from(INTAKE_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30)
    void sendEmail({
      to: NOTIFY,
      subject: `Additional document uploaded — ${app.association} · ${refNum}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.6">
        <p>The applicant uploaded an additional document for <strong>${refNum}</strong> (${app.association}).</p>
        ${label ? `<p><strong>Label:</strong> ${label}</p>` : ''}
        ${signed?.signedUrl ? `<p><a href="${signed.signedUrl}">View the file →</a></p>` : ''}
      </div>`,
    }).catch(() => null)
  }

  return NextResponse.json({ ok: true, documents: await signDocs(documents) })
}
