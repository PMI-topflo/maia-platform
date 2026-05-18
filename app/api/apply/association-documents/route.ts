// =====================================================================
// /api/apply/association-documents
//
// Public (no session) endpoint that returns the current Condo Docs +
// Rules & Regulations PDFs for a given association, with short-lived
// signed download URLs. Used by the new-tenant / new-buyer application
// flow so applicants can read what they're signing.
//
// Returns the MOST RECENT row per category (CINC sync uploads happen
// over time; staff upload a new PDF when bylaws or rules are amended,
// and applicants should see the latest version). The row id is
// returned so the application submit can record exactly which document
// version each applicant acknowledged — important for audit trail when
// rules change later and someone disputes "I never agreed to that."
//
// No auth: this endpoint hands out signed URLs to documents that are
// already obtainable through a public application link. The signed
// URLs expire in 10 minutes so they aren't share-friendly after the
// fact. We never list the storage path itself — only the temporary URL.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_BUCKET, APPLICATION_REQUIRED_CATEGORIES, categoryLabel } from '@/lib/association-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIGNED_URL_TTL_SECONDS = 10 * 60   // 10 min — long enough to read, short enough to expire mid-share

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('code') ?? '').trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ documents: [] })
  }

  const wanted = [...APPLICATION_REQUIRED_CATEGORIES]
  // Pull just the columns the applicant page needs — no notes,
  // extracted_text, etc. Newest first per category. We grab ALL
  // languages here; the applicant picks which one to read + sign.
  const { data, error } = await supabaseAdmin
    .from('association_documents')
    .select('id, category, language, filename, storage_path, drive_url, source, effective_date, created_at')
    .eq('association_code', code)
    .in('category', wanted)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ documents: [], error: error.message }, { status: 500 })
  }

  // Keep the newest row per (category, language) pair. Each category
  // can have one current row per uploaded language; the apply form
  // shows a language picker when there's more than one.
  const latestByKey = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    const key = `${row.category}|${row.language ?? 'en'}`
    if (!latestByKey.has(key)) latestByKey.set(key, row)
  }

  // Build signed URLs in parallel.
  const docs = await Promise.all(
    [...latestByKey.values()].map(async row => {
      let downloadUrl: string | null = null
      if (row.source === 'drive_link' && row.drive_url) {
        downloadUrl = row.drive_url
      } else if (row.storage_path) {
        const { data: signed } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          // download=false keeps the PDF inline in the iframe rather
          // than forcing a Save-as. Applicants still get a download
          // button via the original signed URL.
          .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)
        downloadUrl = signed?.signedUrl ?? null
      }
      return {
        id:             row.id,
        category:       row.category,
        category_label: categoryLabel(row.category),
        language:       row.language ?? 'en',
        filename:       row.filename,
        effective_date: row.effective_date,
        view_url:       downloadUrl,
      }
    }),
  )

  // Group by category for the apply form. Each group lists every
  // available language; the form picks the applicant's UI language
  // when available and falls back to English (or the first lang) when
  // not.
  const byCategory = new Map<string, ReturnType<() => typeof docs[number]>[]>()
  for (const d of docs.filter(d => !!d.view_url)) {
    const arr = byCategory.get(d.category) ?? []
    arr.push(d)
    byCategory.set(d.category, arr)
  }

  return NextResponse.json({
    // Flat list — kept for backwards-compatibility with anything that
    // already consumes the endpoint. Lists ONE doc per (cat, lang).
    documents: [...byCategory.values()].flat(),
    // Grouped shape — what the new apply form uses.
    by_category: [...byCategory.entries()].map(([category, items]) => ({
      category,
      category_label: items[0]?.category_label ?? category,
      languages:      items.map(i => ({
        id:             i.id,
        language:       i.language,
        filename:       i.filename,
        effective_date: i.effective_date,
        view_url:       i.view_url,
      })),
    })),
  })
}
