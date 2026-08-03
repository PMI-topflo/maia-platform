// GET /api/units/document-preview?account=…&assoc=…&key=unit.leasing
// Render one of a unit's on-file documents (by compliance item key) as inline
// page images, so the BOARD / manager can eyeball it on the unit page without
// a Google account. Resolves the compliance_record's drive_url → Drive fileId,
// fetches the bytes via the service account, rasterizes PDFs. Authed via the
// units portal (board / on-site manager / unit manager / staff).

import { NextResponse } from 'next/server'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
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
function driveFileId(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const account = (url.searchParams.get('account') || '').trim()
  const itemKey = (url.searchParams.get('key') || '').trim()
  const auth = await resolveUnitsAuth(url.searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ pages: [], error: 'Unauthorized' }, { status: 401 })
  if (!account || !itemKey) return NextResponse.json({ pages: [], error: 'account and key required' }, { status: 400 })
  if (auth.managedUnits && !auth.managedUnits.includes(account)) return NextResponse.json({ pages: [], error: 'forbidden' }, { status: 403 })

  const { data: rec } = await supabaseAdmin.from('compliance_records')
    .select('drive_url').eq('scope', 'unit').eq('association_code', auth.assoc).eq('unit_ref', account).eq('item_key', itemKey).maybeSingle()
  const link = rec?.drive_url as string | null
  if (!link) return NextResponse.json({ pages: [], error: 'No file on file for this item.' }, { status: 200 })
  const fileId = driveFileId(link)
  if (!fileId) return NextResponse.json({ pages: [], error: 'Could not resolve the file.' }, { status: 200 })

  try {
    const buf = await downloadDriveFile(fileId)
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
    if (isPdf) return NextResponse.json({ pages: await renderPdfToImageDataUrls(buf, { maxPages: 12 }) })
    const mime = imageMime(buf)
    if (mime) return NextResponse.json({ pages: [`data:${mime};base64,${buf.toString('base64')}`] })
    return NextResponse.json({ pages: [], error: 'Unsupported file type for preview.' })
  } catch (e) {
    return NextResponse.json({ pages: [], error: `Could not open file: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
