// =====================================================================
// /api/admin/associations/[code]/insurance/[id]
//
// PATCH  → edit fields on a policy row, OR archive/restore it.
//          - { action: 'archive' }            → set archived_at
//          - { action: 'restore' }            → archive others in type,
//                                               then un-archive this row
//          - any other body                   → partial field update
// DELETE → remove the row + its COI storage object (if any).
// GET    → short-lived signed download URL for the COI.
//
// Staff-only. Scoped by association_code AND id together so a URL typo
// can't reach another association's policy.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { INSURANCE_COI_BUCKET } from '@/lib/association-insurance'

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
function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
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

export async function PATCH(req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const upperCode = code.toUpperCase()

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const actor = actorEmail(session)

  // ── action: archive ──────────────────────────────────────────────
  if (body.action === 'archive') {
    const { error } = await supabaseAdmin
      .from('association_insurance_policies')
      .update({ archived_at: new Date().toISOString(), archived_by_email: actor })
      .eq('id', id)
      .eq('association_code', upperCode)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── action: restore ──────────────────────────────────────────────
  if (body.action === 'restore') {
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('association_insurance_policies')
      .select('policy_type')
      .eq('id', id)
      .eq('association_code', upperCode)
      .maybeSingle()
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    if (!row)     return NextResponse.json({ error: 'Policy not found' }, { status: 404 })

    // Archive every OTHER active row of this policy_type so the restored
    // row is unambiguously current (satisfies the partial-unique index).
    await supabaseAdmin
      .from('association_insurance_policies')
      .update({ archived_at: new Date().toISOString(), archived_by_email: actor })
      .eq('association_code', upperCode)
      .eq('policy_type', row.policy_type)
      .is('archived_at', null)
      .neq('id', id)

    const { error: restoreErr } = await supabaseAdmin
      .from('association_insurance_policies')
      .update({ archived_at: null, archived_by_email: null })
      .eq('id', id)
      .eq('association_code', upperCode)
    if (restoreErr) return NextResponse.json({ error: restoreErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // ── field update ─────────────────────────────────────────────────
  // Build the patch only from keys the caller actually sent so a form
  // editing one field doesn't null out the rest.
  const patch: Record<string, unknown> = {}
  if ('carrier'             in body) patch.carrier             = cleanText(body.carrier)
  if ('policy_number'       in body) patch.policy_number       = cleanText(body.policy_number)
  if ('named_insured'       in body) patch.named_insured       = cleanText(body.named_insured)
  if ('effective_date'      in body) patch.effective_date      = cleanDate(body.effective_date)
  if ('expiration_date'     in body) patch.expiration_date     = cleanDate(body.expiration_date)
  if ('coverage_amount_usd' in body) patch.coverage_amount_usd = cleanNumber(body.coverage_amount_usd)
  if ('premium_usd'         in body) patch.premium_usd         = cleanNumber(body.premium_usd)
  if ('agent_name'          in body) patch.agent_name          = cleanText(body.agent_name)
  if ('agent_email'         in body) patch.agent_email         = cleanText(body.agent_email)
  if ('agent_phone'         in body) patch.agent_phone         = cleanText(body.agent_phone)
  if ('notes'               in body) patch.notes               = cleanText(body.notes)
  if ('waived'              in body) patch.waived              = body.waived === true
  if ('waived_reason'       in body) patch.waived_reason       = cleanText(body.waived_reason)
  if ('drive_url'           in body) patch.drive_url           = cleanUrl(body.drive_url)

  // COI replacement — validate prefix and remember the old object so we
  // can clean it up after the row update succeeds.
  let oldCoiPath: string | null = null
  if ('coi_storage_path' in body) {
    const newPath = cleanText(body.coi_storage_path)
    if (newPath && !newPath.startsWith(`${upperCode}/insurance/`)) {
      return NextResponse.json({ error: 'coi_storage_path does not belong to this association' }, { status: 400 })
    }
    const { data: existing } = await supabaseAdmin
      .from('association_insurance_policies')
      .select('coi_storage_path')
      .eq('id', id)
      .eq('association_code', upperCode)
      .maybeSingle()
    if (existing?.coi_storage_path && existing.coi_storage_path !== newPath) {
      oldCoiPath = existing.coi_storage_path
    }
    patch.coi_storage_path    = newPath
    patch.coi_filename        = cleanText(body.coi_filename)
    patch.coi_mime_type       = cleanText(body.coi_mime_type)
    patch.coi_file_size_bytes = cleanNumber(body.coi_file_size_bytes)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('association_insurance_policies')
    .update(patch)
    .eq('id', id)
    .eq('association_code', upperCode)
    .select('*')
    .maybeSingle()
  if (error)   return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Policy not found for this association' }, { status: 404 })

  if (oldCoiPath) {
    await supabaseAdmin.storage.from(INSURANCE_COI_BUCKET).remove([oldCoiPath]).catch(() => {})
  }

  return NextResponse.json({ ok: true, policy: updated })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const upperCode = code.toUpperCase()

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('association_insurance_policies')
    .select('id, coi_storage_path')
    .eq('id', id)
    .eq('association_code', upperCode)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!row)     return NextResponse.json({ error: 'Policy not found for this association' }, { status: 404 })

  if (row.coi_storage_path) {
    await supabaseAdmin.storage.from(INSURANCE_COI_BUCKET).remove([row.coi_storage_path]).catch(() => {})
  }

  const { error: delErr } = await supabaseAdmin
    .from('association_insurance_policies')
    .delete()
    .eq('id', id)
    .eq('association_code', upperCode)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function GET(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code, id } = await ctx.params
  const { data: row, error } = await supabaseAdmin
    .from('association_insurance_policies')
    .select('coi_storage_path, coi_filename, drive_url')
    .eq('id', id)
    .eq('association_code', code.toUpperCase())
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row)  return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
  // Prefer the uploaded file (authoritative, in-system); fall back to the
  // Drive link when the file lives only in Drive.
  if (!row.coi_storage_path) {
    if (row.drive_url) return NextResponse.json({ url: row.drive_url, source: 'drive' })
    return NextResponse.json({ error: 'No COI on file for this policy' }, { status: 404 })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(INSURANCE_COI_BUCKET)
    .createSignedUrl(row.coi_storage_path, 5 * 60, { download: row.coi_filename ?? undefined })
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: `Could not sign URL: ${signErr?.message}` }, { status: 500 })
  }
  return NextResponse.json({ url: signed.signedUrl, filename: row.coi_filename })
}
