// =====================================================================
// /api/admin/associations/[code]/safety
//
// GET  → list association_safety_inspections for this association.
//        Active rows by default; ?include_archived=1 for history.
// POST → create a new inspection row. A renewal supersedes the prior
//        active row for the same (inspection_type, building_label) — we
//        archive it first so the partial-unique active index holds.
//
// Staff-only. Report PDFs upload separately via the upload-url route.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { INSPECTION_TYPE_KEYS, type AssociationSafetyInspection } from '@/lib/association-safety'

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
function cleanUrl(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return /^https?:\/\/\S+$/i.test(s) ? s : null
}

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const url = new URL(req.url)
  const includeArchived = url.searchParams.get('include_archived') === '1'

  let query = supabaseAdmin
    .from('association_safety_inspections')
    .select('*')
    .eq('association_code', code.toUpperCase())
    .order('created_at', { ascending: false })

  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inspections: (data ?? []) as AssociationSafetyInspection[] })
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const upperCode = code.toUpperCase()

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const inspectionType = (typeof body.inspection_type === 'string' ? body.inspection_type : '').trim()
  if (!INSPECTION_TYPE_KEYS.has(inspectionType)) {
    return NextResponse.json({ error: `Unknown inspection_type "${inspectionType}"` }, { status: 400 })
  }
  const buildingLabel = cleanText(body.building_label)

  const reportPath = cleanText(body.report_storage_path)
  if (reportPath && !reportPath.startsWith(`${upperCode}/safety/`)) {
    return NextResponse.json({ error: 'report_storage_path does not belong to this association' }, { status: 400 })
  }

  const waived = body.waived === true

  // Archive the prior active row for this (assoc, type, building) FIRST
  // so the partial-unique active index holds when we insert the renewal.
  let archiveQ = supabaseAdmin
    .from('association_safety_inspections')
    .update({ archived_at: new Date().toISOString(), archived_by_email: actorEmail(session) })
    .eq('association_code', upperCode)
    .eq('inspection_type', inspectionType)
    .is('archived_at', null)
  archiveQ = buildingLabel === null ? archiveQ.is('building_label', null) : archiveQ.eq('building_label', buildingLabel)
  await archiveQ

  const { data: inserted, error } = await supabaseAdmin
    .from('association_safety_inspections')
    .insert({
      association_code:       upperCode,
      inspection_type:        inspectionType,
      building_label:         buildingLabel,
      year_built:             cleanInt(body.year_built),
      stories:                cleanInt(body.stories),
      coastal:                body.coastal === true,
      last_completed_date:    cleanDate(body.last_completed_date),
      next_due_date:          cleanDate(body.next_due_date),
      provider:               cleanText(body.provider),
      report_storage_path:    reportPath,
      report_filename:        cleanText(body.report_filename),
      report_mime_type:       cleanText(body.report_mime_type),
      report_file_size_bytes: cleanInt(body.report_file_size_bytes),
      drive_url:              cleanUrl(body.drive_url),
      waived,
      waived_reason:          waived ? cleanText(body.waived_reason) : null,
      notes:                  cleanText(body.notes),
      created_by_email:       actorEmail(session),
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === '23505' ? 409 : 500 })
  }
  return NextResponse.json({ ok: true, inspection: inserted as AssociationSafetyInspection })
}
