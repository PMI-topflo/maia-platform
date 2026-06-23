// =====================================================================
// POST /api/admin/teach/ingest   (multipart OR json)
// The front of the teach loop: take an upload (PDF / image) or pasted
// text, have MAIA READ it (vision for images, pdf-parse for PDFs), then
// propose what she understood + the canonical knowledge. Inserts a
// `needs_review` row and returns it for the studio to show. Staff-only.
//
// multipart fields: file, association_code?, persona?, title?, hint?
// json body:        { text, association_code?, persona?, title?, hint? }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { extractPdfText } from '@/lib/extract-pdf'
import { extractImageText } from '@/lib/extract-image'
import { understandContent, type KnowledgeSource, type KnowledgeKind } from '@/lib/maia-knowledge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB
const KNOWLEDGE_BUCKET = 'maia-skills'  // reuse the existing MAIA bucket

async function requireStaff(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  return session && session.persona === 'staff' ? session : null
}

function nullable(v: FormDataEntryValue | string | null | undefined): string | null {
  const s = (v ?? '').toString().trim()
  return s ? s : null
}

export async function POST(req: NextRequest) {
  const session = await requireStaff(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const actor = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : (session.contactName ?? 'staff')

  const ct = req.headers.get('content-type') ?? ''

  let associationCode: string | null = null
  let persona: string | null = null
  let accountNumber: string | null = null
  let unitNumber: string | null = null
  let kind: KnowledgeKind = 'knowledge'
  let titleHint: string | null = null
  let hint: string | null = null
  let sourceKind: KnowledgeSource = 'text'
  let sourceFilename: string | null = null
  let sourcePath: string | null = null
  let rawText = ''

  try {
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      associationCode = nullable(form.get('association_code'))
      persona = nullable(form.get('persona'))
      accountNumber = nullable(form.get('account_number'))
      unitNumber = nullable(form.get('unit_number'))
      if (nullable(form.get('kind')) === 'behavior') kind = 'behavior'
      titleHint = nullable(form.get('title'))
      hint = nullable(form.get('hint'))
      const pastedText = nullable(form.get('text'))
      const file = form.get('file')

      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB` }, { status: 400 })
        const buf = Buffer.from(await file.arrayBuffer())
        sourceFilename = file.name
        const mime = file.type || ''
        const isPdf = mime.includes('pdf') || /\.pdf$/i.test(file.name)
        const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name)

        if (isPdf) {
          sourceKind = 'pdf'
          const r = await extractPdfText(buf, mime || 'application/pdf')
          if (r.status !== 'done' || !r.text) return NextResponse.json({ error: `Couldn't read PDF: ${r.error ?? 'no text found'}` }, { status: 422 })
          rawText = r.text
        } else if (isImage) {
          sourceKind = 'image'
          const r = await extractImageText(buf, mime || 'image/jpeg')
          if (r.status !== 'done' || !r.text) return NextResponse.json({ error: `Couldn't read image: ${r.error ?? 'no text found'}` }, { status: 422 })
          rawText = r.text
        } else {
          return NextResponse.json({ error: 'Unsupported file type. Upload a PDF or image, or paste text.' }, { status: 400 })
        }

        // Best-effort: keep the original so staff can re-review later.
        const path = `knowledge/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
        const up = await supabaseAdmin.storage.from(KNOWLEDGE_BUCKET).upload(path, buf, { contentType: mime || undefined, upsert: false })
        if (!up.error) sourcePath = path
      } else if (pastedText) {
        sourceKind = 'text'
        rawText = pastedText
      } else {
        return NextResponse.json({ error: 'Provide a file or some text to teach.' }, { status: 400 })
      }
    } else {
      const body = await req.json().catch(() => ({}))
      associationCode = nullable(body.association_code)
      persona = nullable(body.persona)
      accountNumber = nullable(body.account_number)
      unitNumber = nullable(body.unit_number)
      if (nullable(body.kind) === 'behavior') kind = 'behavior'
      titleHint = nullable(body.title)
      hint = nullable(body.hint)
      rawText = (body.text ?? '').toString().trim()
      sourceKind = 'text'
      if (!rawText) return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'bad request' }, { status: 400 })
  }

  if (!rawText.trim()) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 })

  // A unit/account scope only makes sense within an association.
  if (!associationCode) { accountNumber = null; unitNumber = null }

  // Resolve association name for nicer prompting.
  let associationName: string | null = null
  if (associationCode) {
    const { data } = await supabaseAdmin.from('associations').select('association_name').eq('association_code', associationCode).maybeSingle()
    associationName = data?.association_name ?? null
  }

  let understood
  try {
    understood = await understandContent(rawText, { associationName, persona, hint: hint ?? undefined, kind })
  } catch (e) {
    return NextResponse.json({ error: `MAIA couldn't process this: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 502 })
  }

  const { data: row, error } = await supabaseAdmin
    .from('maia_knowledge')
    .insert({
      association_code:   associationCode,
      persona,
      account_number:     accountNumber,
      unit_number:        unitNumber,
      kind,
      title:              titleHint ?? understood.title,
      source_kind:        sourceKind,
      source_filename:    sourceFilename,
      source_path:        sourcePath,
      raw_extract:        rawText.slice(0, 500_000),
      understood_summary: understood.understood,
      approved_body:      understood.knowledge,
      status:             'needs_review',
      created_by:         actor,
    })
    .select('id, association_code, persona, account_number, unit_number, kind, title, source_kind, source_filename, understood_summary, approved_body, status, created_by, reviewed_by, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: row })
}
