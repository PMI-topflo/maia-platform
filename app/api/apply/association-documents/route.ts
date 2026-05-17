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
  // extracted_text, etc. Newest first per category.
  const { data, error } = await supabaseAdmin
    .from('association_documents')
    .select('id, category, filename, storage_path, drive_url, source, effective_date, created_at')
    .eq('association_code', code)
    .in('category', wanted)
    // Only current (non-archived) versions are eligible to surface to
    // applicants. Older uploads stay in the table for audit history
    // but new applicants should always sign the latest version.
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ documents: [], error: error.message }, { status: 500 })
  }

  // Keep only the newest row per category. The DB has multiple versions
  // over time (each upload appends); applicants should only see / sign
  // the current one. Older versions stay in the DB for audit history.
  const latestByCategory = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    if (!latestByCategory.has(row.category)) latestByCategory.set(row.category, row)
  }

  // Build signed URLs in parallel. Drive-link rows (source='drive_link')
  // just echo back the URL — no signing needed.
  const docs = await Promise.all(
    [...latestByCategory.values()].map(async row => {
      let downloadUrl: string | null = null
      if (row.source === 'drive_link' && row.drive_url) {
        downloadUrl = row.drive_url
      } else if (row.storage_path) {
        const { data: signed } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, { download: row.filename })
        downloadUrl = signed?.signedUrl ?? null
      }
      return {
        id:             row.id,
        category:       row.category,
        category_label: categoryLabel(row.category),
        filename:       row.filename,
        effective_date: row.effective_date,
        download_url:   downloadUrl,
      }
    }),
  )

  return NextResponse.json({ documents: docs.filter(d => !!d.download_url) })
}
