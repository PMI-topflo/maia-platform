// =====================================================================
// lib/governing-docs-for-portal.ts
//
// Server-side helper for /my-account and /board pages: returns the
// CURRENT governing documents (Condo Docs + Rules) for an association
// with short-lived signed download URLs. Same data as the public
// /api/apply/association-documents endpoint, but consumed at render
// time instead of fetched from the client — saves a round-trip and
// the URLs aren't baked into a public response.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  STORAGE_BUCKET,
  APPLICATION_REQUIRED_CATEGORIES,
  categoryLabel,
} from '@/lib/association-documents'

export interface PortalGoverningDoc {
  id:             string
  category:       string
  category_label: string
  filename:       string
  effective_date: string | null
  download_url:   string
}

const SIGNED_URL_TTL_SECONDS = 10 * 60   // 10 min — matches the apply endpoint

export async function getGoverningDocsForPortal(assocCode: string): Promise<PortalGoverningDoc[]> {
  const code = assocCode.toUpperCase()
  const wanted = [...APPLICATION_REQUIRED_CATEGORIES]

  const { data } = await supabaseAdmin
    .from('association_documents')
    .select('id, category, filename, storage_path, drive_url, source, effective_date, created_at')
    .eq('association_code', code)
    .in('category', wanted)
    // Skip archived versions — owners + board members always see the
    // current Condo Docs / Rules, matching what new applicants sign.
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  // Keep only the newest row per category — same "latest version wins"
  // rule the applicant flow uses so what owners/board see lines up
  // with what new applicants are being asked to sign.
  const latest = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    if (!latest.has(row.category)) latest.set(row.category, row)
  }

  const docs = await Promise.all(
    [...latest.values()].map(async row => {
      let downloadUrl: string | null = null
      if (row.source === 'drive_link' && row.drive_url) {
        downloadUrl = row.drive_url
      } else if (row.storage_path) {
        const { data: signed } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, { download: row.filename })
        downloadUrl = signed?.signedUrl ?? null
      }
      if (!downloadUrl) return null
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

  return docs.filter((d): d is PortalGoverningDoc => d !== null)
}
