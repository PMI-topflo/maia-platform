// GET /api/board/estimate/preview?token=
// The chosen estimate rendered as inline images (so board members read it
// without downloading a PDF). PDFs → one JPEG per page; images pass through.
// Public (token-gated).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { renderPdfToImageDataUrls } from '@/lib/pdf-normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token) return NextResponse.json({ pages: [] })

  const { data: review } = await supabaseAdmin.from('estimate_approval_reviews').select('approval_id').eq('token', token).single()
  if (!review) return NextResponse.json({ pages: [] })
  const { data: approval } = await supabaseAdmin.from('estimate_approvals').select('vendor_request_id').eq('id', review.approval_id).single()
  if (!approval?.vendor_request_id) return NextResponse.json({ pages: [] })
  const { data: erv } = await supabaseAdmin.from('estimate_request_vendors').select('estimate_path').eq('id', approval.vendor_request_id).single()
  if (!erv?.estimate_path) return NextResponse.json({ pages: [] })
  const { data: att } = await supabaseAdmin.from('work_order_attachments').select('storage_path, mime_type').eq('id', erv.estimate_path).single()
  if (!att?.storage_path) return NextResponse.json({ pages: [] })

  // An image estimate → just hand back a signed URL.
  if ((att.mime_type ?? '').startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(att.storage_path)) {
    const { data: signed } = await supabaseAdmin.storage.from('work-order-photos').createSignedUrl(att.storage_path, 3600)
    return NextResponse.json({ pages: signed?.signedUrl ? [signed.signedUrl] : [] })
  }

  const { data: blob, error } = await supabaseAdmin.storage.from('work-order-photos').download(att.storage_path)
  if (error || !blob) return NextResponse.json({ pages: [] })
  const pages = await renderPdfToImageDataUrls(Buffer.from(await blob.arrayBuffer()), { maxPages: 8 })
  return NextResponse.json({ pages })
}
