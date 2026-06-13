// =====================================================================
// GET /api/admin/vendor-compliance/files?tickets=1,2,3
// Returns the work-order attachments (estimates, invoices, COI/W-9/ACH,
// photos) across a vendor's active work orders as openable file links —
// signed URLs, newest first. Staff-only. Loaded lazily when a vendor row
// is expanded on the audit page.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_BUCKET } from '@/lib/work-order-attachments'
import { vendorDocTypeLabel, type VendorDocType } from '@/lib/vendor-doc-extraction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ids = (new URL(req.url).searchParams.get('tickets') ?? '')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite).slice(0, 100)
  if (ids.length === 0) return NextResponse.json({ files: [] })

  const { data: atts } = await supabaseAdmin.from('work_order_attachments')
    .select('id, ticket_id, filename, storage_path, mime_type, extracted_doc_type, created_at')
    .in('ticket_id', ids)
    .order('created_at', { ascending: false })
    .limit(60)

  const files = await Promise.all((atts ?? []).map(async a => {
    let url: string | null = null
    if (a.storage_path) {
      const { data: signed } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(a.storage_path as string, 60 * 60)
      url = signed?.signedUrl ?? null
    }
    const mime = (a.mime_type as string | null) ?? ''
    return {
      id: a.id,
      ticketId: a.ticket_id,
      filename: a.filename as string,
      url,
      isImage: mime.startsWith('image/'),
      isPdf: mime === 'application/pdf' || String(a.filename ?? '').toLowerCase().endsWith('.pdf'),
      docType: a.extracted_doc_type ? vendorDocTypeLabel(a.extracted_doc_type as VendorDocType) : null,
      createdAt: a.created_at,
    }
  }))

  return NextResponse.json({ files })
}
