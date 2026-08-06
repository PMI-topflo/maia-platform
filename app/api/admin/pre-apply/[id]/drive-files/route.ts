// GET /api/admin/pre-apply/[id]/drive-files
// Lists every file in the application's linked On Going Drive folder, so staff
// can browse and assign one to a checklist item (Replace-from-Drive). Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('drive_folder_id').eq('id', id).maybeSingle()
  const root = String(app?.drive_folder_id ?? '')
  if (!root) return NextResponse.json({ files: [], error: 'No Drive folder linked.' })

  try {
    const drive = getDrive()
    const out: { fileId: string; name: string; mimeType: string }[] = []
    let frontier = [root]; const seen = new Set<string>(); let guard = 0
    while (frontier.length && guard < 200) {
      const next: string[] = []
      for (const fid of frontier) {
        if (seen.has(fid)) continue; seen.add(fid); guard++
        const res = await drive.files.list({ q: `'${fid}' in parents and trashed = false`, fields: 'files(id, name, mimeType)', pageSize: 200, supportsAllDrives: true, includeItemsFromAllDrives: true })
        for (const f of res.data.files ?? []) {
          if (f.mimeType === FOLDER_MIME) next.push(f.id as string)
          else out.push({ fileId: f.id as string, name: f.name ?? '', mimeType: f.mimeType ?? 'application/octet-stream' })
        }
      }
      frontier = next
    }
    return NextResponse.json({ files: out })
  } catch (e) { return NextResponse.json({ files: [], error: e instanceof Error ? e.message : String(e) }) }
}
