// =====================================================================
// /api/admin/associations/[code]/safety/[id]
//
// PATCH  → edit fields, or { action: 'archive' | 'restore' }.
// DELETE → remove the row + its report storage object (if any).
// GET    → short-lived signed download URL for the report.
//
// Staff-only. Scoped by association_code AND id together.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SAFETY_REPORT_BUCKET } from '@/lib/association-safety'

export const dynamic = 'force-dynamic'

async function requireStaff() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  return session
}
function actorEmail(session: { userId: string | number }): string | null {
  return typeof session.userId === 'string' && session.userId.includes('@')
    ? session.userId.toLowerCase()
    : null
}
function cleanDate(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function cleanInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}
function cleanText(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return s.length ? s : null
}

export async function PATCH(req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const upperCode = code.toUpperCase()

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const actor = actorEmail(session)

  if (body.action === 'archive') {
    const { error } = await supabaseAdmin
      .from('association_safety_inspections')
      .update({ archived_at: new Date().toISOString(), archived_by_email: actor })
      .eq('id', id).eq('association_code', upperCode)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'restore') {
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('association_safety_inspections')
      .select('inspection_type, building_label')
      .eq('id', id).eq('association_code', upperCode).maybeSingle()
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    if (!row)     return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

    let q = supabaseAdmin
      .from('association_safety_inspections')
      .update({ archived_at: new Date().toISOString(), archived_by_email: actor })
      .eq('association_code', upperCode)
      .eq('inspection_type', row.inspection_type)
      .is('archived_at', null)
      .neq('id', id)
    q = row.building_label === null ? q.is('building_label', null) : q.eq('building_label', row.building_label)
    await q

    const { error: restoreErr } = await supabaseAdmin
      .from('association_safety_inspections')
      .update({ archived_at: null, archived_by_email: null })
      .eq('id', id).eq('association_code', upperCode)
    if (restoreErr) return NextResponse.json({ error: restoreErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const patch: Record<string, unknown> = {}
  if ('building_label'      in body) patch.building_label      = cleanText(body.building_label)
  if ('year_built'         in body) patch.year_built          = cleanInt(body.year_built)
  if ('stories'            in body) patch.stories             = cleanInt(body.stories)
  if ('coastal'            in body) patch.coastal             = body.coastal === true
  if ('last_completed_date' in body) patch.last_completed_date = cleanDate(body.last_completed_date)
  if ('next_due_date'      in body) patch.next_due_date       = cleanDate(body.next_due_date)
  if ('provider'           in body) patch.provider            = cleanText(body.provider)
  if ('notes'              in body) patch.notes               = cleanText(body.notes)
  if ('waived'             in body) patch.waived              = body.waived === true
  if ('waived_reason'      in body) patch.waived_reason       = cleanText(body.waived_reason)

  let oldReportPath: string | null = null
  if ('report_storage_path' in body) {
    const newPath = cleanText(body.report_storage_path)
    if (newPath && !newPath.startsWith(`${upperCode}/safety/`)) {
      return NextResponse.json({ error: 'report_storage_path does not belong to this association' }, { status: 400 })
    }
    const { data: existing } = await supabaseAdmin
      .from('association_safety_inspections')
      .select('report_storage_path')
      .eq('id', id).eq('association_code', upperCode).maybeSingle()
    if (existing?.report_storage_path && existing.report_storage_path !== newPath) {
      oldReportPath = existing.report_storage_path
    }
    patch.report_storage_path    = newPath
    patch.report_filename        = cleanText(body.report_filename)
    patch.report_mime_type       = cleanText(body.report_mime_type)
    patch.report_file_size_bytes = cleanInt(body.report_file_size_bytes)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('association_safety_inspections')
    .update(patch)
    .eq('id', id).eq('association_code', upperCode)
    .select('*').maybeSingle()
  if (error)    return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Inspection not found for this association' }, { status: 404 })

  if (oldReportPath) {
    await supabaseAdmin.storage.from(SAFETY_REPORT_BUCKET).remove([oldReportPath]).catch(() => {})
  }
  return NextResponse.json({ ok: true, inspection: updated })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const upperCode = code.toUpperCase()

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('association_safety_inspections')
    .select('id, report_storage_path')
    .eq('id', id).eq('association_code', upperCode).maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!row)     return NextResponse.json({ error: 'Inspection not found for this association' }, { status: 404 })

  if (row.report_storage_path) {
    await supabaseAdmin.storage.from(SAFETY_REPORT_BUCKET).remove([row.report_storage_path]).catch(() => {})
  }
  const { error: delErr } = await supabaseAdmin
    .from('association_safety_inspections')
    .delete().eq('id', id).eq('association_code', upperCode)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const { data: row, error } = await supabaseAdmin
    .from('association_safety_inspections')
    .select('report_storage_path, report_filename')
    .eq('id', id).eq('association_code', code.toUpperCase()).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row)  return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  if (!row.report_storage_path) {
    return NextResponse.json({ error: 'No report on file for this inspection' }, { status: 404 })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(SAFETY_REPORT_BUCKET)
    .createSignedUrl(row.report_storage_path, 5 * 60, { download: row.report_filename ?? undefined })
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: `Could not sign URL: ${signErr?.message}` }, { status: 500 })
  }
  return NextResponse.json({ url: signed.signedUrl, filename: row.report_filename })
}
