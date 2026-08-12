// POST /api/admin/pre-apply/[id]/mirror-drive
// Push this application's saved documents up to the unit's "On Going
// Applications" Drive folder (creating it if needed). Uploads mirror themselves
// now, but applications that collected documents BEFORE that existed — or whose
// mirror failed while Drive was unreachable — have files sitting only in MAIA.
// Safe to re-run: mirrorIntakeToDrive skips what is already there. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { mirrorIntakeToDrive } from '@/lib/drive-application-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const { count } = await supabaseAdmin.from('application_documents')
    .select('id', { count: 'exact', head: true }).eq('application_id', id)
  if (!count) return NextResponse.json({ error: 'This application has no saved documents to send.' }, { status: 400 })

  const res = await mirrorIntakeToDrive(id)
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'Could not reach Drive.' }, { status: 200 })

  const { data: app } = await supabaseAdmin.from('listing_applications')
    .select('drive_folder_url').eq('id', id).maybeSingle()
  return NextResponse.json({ ok: true, documents: count, folderUrl: (app?.drive_folder_url as string | null) ?? null })
}
