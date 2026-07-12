// GET /api/document-preview?url=<encoded Supabase Storage URL>
//
// Renders a stored applicant document or Checkr report as inline images
// instead of forcing a download -- backs the preview popup on the staff
// Applications dashboard and the board review page. Only ever fetches
// from our own Supabase Storage host (see lib/document-preview.ts) --
// the URL itself already carries whatever auth it needs (public bucket
// URL, or a Checkr-report signed URL), same as the plain links this
// replaces.

import { NextResponse } from 'next/server'
import { urlToPreviewPages, isAllowedStorageUrl } from '@/lib/document-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url') ?? ''
  if (!url || !isAllowedStorageUrl(url)) {
    return NextResponse.json({ pages: [], error: 'Invalid document URL' }, { status: 400 })
  }
  return NextResponse.json({ pages: await urlToPreviewPages(url) })
}
