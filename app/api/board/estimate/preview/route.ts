// GET /api/board/estimate/preview?token=&erv=<ervId>
// A vendor estimate rendered as inline images (so board members read it
// without downloading a PDF). PDFs → one JPEG per page; images pass through.
// `erv` selects which vendor in the comparison (validated to belong to this
// approval's request); omit it to fall back to the approval's stamped winner.
// Public (token-gated).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { estimatePagesForErv, ervBelongsToRequest } from '@/lib/estimate-preview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  const erv = url.searchParams.get('erv') ?? ''
  if (!token) return NextResponse.json({ pages: [] })

  const { data: review } = await supabaseAdmin.from('estimate_approval_reviews').select('approval_id').eq('token', token).single()
  if (!review) return NextResponse.json({ pages: [] })
  const { data: approval } = await supabaseAdmin.from('estimate_approvals').select('request_id, vendor_request_id').eq('id', review.approval_id).single()
  if (!approval) return NextResponse.json({ pages: [] })

  // Which vendor? An explicit `erv` (validated against this approval's RFQ),
  // else the approval's stamped winner (legacy single-vendor approvals).
  let ervId: string | null = null
  if (erv) {
    if (!(await ervBelongsToRequest(erv, approval.request_id as string | null))) return NextResponse.json({ pages: [] })
    ervId = erv
  } else {
    ervId = approval.vendor_request_id as string | null
  }

  return NextResponse.json({ pages: await estimatePagesForErv(ervId) })
}
