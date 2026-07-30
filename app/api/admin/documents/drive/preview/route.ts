// GET /api/admin/documents/drive/preview?fileId=...
// Render a Drive file as inline page images so staff can eyeball it in the
// organize/rename screen without downloading. Fetches the bytes via the
// service account (which impersonates PMI), rasterizes PDFs, and hands images
// back as data URLs. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { downloadDriveFile } from '@/lib/drive-import'
import { renderPdfToImageDataUrls } from '@/lib/pdf-normalize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function imageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  return null
}

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ pages: [], error: 'Unauthorized' }, { status: 401 })
  const fileId = new URL(req.url).searchParams.get('fileId') ?? ''
  if (!fileId) return NextResponse.json({ pages: [], error: 'fileId required' }, { status: 400 })

  try {
    const buf = await downloadDriveFile(fileId)   // exports Google-native → PDF automatically
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
    if (isPdf) return NextResponse.json({ pages: await renderPdfToImageDataUrls(buf, { maxPages: 12 }) })
    const mime = imageMime(buf)
    if (mime) return NextResponse.json({ pages: [`data:${mime};base64,${buf.toString('base64')}`] })
    return NextResponse.json({ pages: [], error: 'Unsupported file type for preview.' })
  } catch (e) {
    return NextResponse.json({ pages: [], error: `Could not open file: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
