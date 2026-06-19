// =====================================================================
// lib/portal-documents.ts
//
// Documents shown on a resident portal — sourced entirely from MAIA
// (association_documents + Supabase storage), NOT Google Drive. Returns
// the CURRENT (non-archived) file in each category with a short-lived
// signed download URL, grouped by category group for display.
//
// Service-role only — call from a session-gated API route so signed URLs
// are never baked into a public page.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_BUCKET, CATEGORIES, categoryLabel, categoryGroup } from '@/lib/association-documents'

const SIGNED_URL_TTL_SECONDS = 10 * 60

export interface PortalDoc {
  id:             string
  category:       string
  category_label: string
  filename:       string
  effective_date: string | null
  download_url:   string
}

export interface PortalDocGroup {
  group: string
  docs:  PortalDoc[]
}

// Stable display order, matching the taxonomy order in CATEGORIES.
const CATEGORY_ORDER = CATEGORIES.map(c => c.key)
const GROUP_ORDER = [...new Set(CATEGORIES.map(c => c.group))]

export async function getPortalDocuments(assocCode: string): Promise<PortalDocGroup[]> {
  const code = assocCode.toUpperCase()

  const { data } = await supabaseAdmin
    .from('association_documents')
    .select('id, category, filename, storage_path, drive_url, source, effective_date, created_at')
    .eq('association_code', code)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  // Show every current document we have a real file for. We keep all rows
  // (not just newest-per-category) so an association can publish several
  // files in one category (e.g. multiple application forms).
  const rows = (data ?? []).filter(r => CATEGORY_ORDER.includes(r.category))

  const docs = await Promise.all(rows.map(async row => {
    let url: string | null = null
    if (row.source === 'drive_link' && row.drive_url) {
      url = row.drive_url   // legacy rows; new uploads are storage-backed
    } else if (row.storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, { download: row.filename })
      url = signed?.signedUrl ?? null
    }
    if (!url) return null
    return {
      id: row.id, category: row.category, category_label: categoryLabel(row.category),
      filename: row.filename, effective_date: row.effective_date, download_url: url,
    } as PortalDoc
  }))

  const live = docs.filter((d): d is PortalDoc => d !== null)

  // Bucket into display groups, each sorted by the taxonomy category order
  // then newest first (rows already arrive newest-first).
  const byGroup = new Map<string, PortalDoc[]>()
  for (const d of live) {
    const g = categoryGroup(d.category)
    const arr = byGroup.get(g) ?? []
    arr.push(d)
    byGroup.set(g, arr)
  }
  for (const arr of byGroup.values()) {
    arr.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
  }

  return GROUP_ORDER
    .filter(g => byGroup.has(g))
    .map(g => ({ group: g, docs: byGroup.get(g)! }))
}
