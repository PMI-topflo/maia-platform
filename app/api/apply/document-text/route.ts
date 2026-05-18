// =====================================================================
// /api/apply/document-text?id=<association_documents.id>
//
// Public endpoint that returns the extracted_text of a single
// association_documents row so the apply form can show the text
// panel beside the PDF iframe. Lazy-loaded — applicants only fetch
// the text when they expand the panel, since extracted_text can run
// to a megabyte+ per doc and we don't want it on the initial page.
//
// Scope guard: only returns text for rows that are STILL ACTIVE
// (archived_at IS NULL) and in one of the APPLICATION_REQUIRED_
// CATEGORIES. Avoids the endpoint being abused as a generic
// document-text reader for stale or non-public docs.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { APPLICATION_REQUIRED_CATEGORIES } from '@/lib/association-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get('id') ?? '').trim()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('association_documents')
    .select('id, category, language, extracted_text, archived_at')
    .eq('id', id)
    .maybeSingle()

  if (error)             return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)             return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (data.archived_at)  return NextResponse.json({ error: 'archived' }, { status: 404 })
  if (!APPLICATION_REQUIRED_CATEGORIES.has(data.category)) {
    return NextResponse.json({ error: 'not an application document' }, { status: 403 })
  }

  return NextResponse.json({
    id:       data.id,
    language: data.language ?? 'en',
    text:     data.extracted_text ?? '',
  })
}
