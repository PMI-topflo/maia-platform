// =====================================================================
// /api/admin/associations/[code]/insurance
//
// GET  → list association_insurance_policies for this association.
//        Active (non-archived) rows by default; ?include_archived=1 to
//        include superseded versions for the history expander.
// POST → create a new policy row (a renewal supersedes the prior active
//        row for the same policy_type — we archive it first so the
//        partial-unique active index holds).
//
// Staff-only. COI files are uploaded separately via the upload-url
// route; this endpoint just records the coi_storage_path + metadata.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeStoredFile } from '@/lib/normalize-stored-file'
import { POLICY_TYPE_KEYS, type AssociationInsurancePolicy } from '@/lib/association-insurance'

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

/** Allow only YYYY-MM-DD or null through to a date column. Empty string
 *  → null so the form can clear a date. */
function cleanDate(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Parse a money/number-ish input to a number or null. Strips $ and
 *  commas so "1,500,000" and "$1500000" both work. */
function cleanNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function cleanText(v: unknown): string | null {
  const s = (typeof v === 'string' ? v : '').trim()
  return s.length ? s : null
}

/** Accept only http(s) URLs (Google Drive links etc.); anything else → null. */
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
    .from('association_insurance_policies')
    .select('*')
    .eq('association_code', code.toUpperCase())
    .order('created_at', { ascending: false })

  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ policies: (data ?? []) as AssociationInsurancePolicy[] })
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await ctx.params
  const upperCode = code.toUpperCase()

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const policyType = (typeof body.policy_type === 'string' ? body.policy_type : '').trim()
  if (!POLICY_TYPE_KEYS.has(policyType)) {
    return NextResponse.json({ error: `Unknown policy_type "${policyType}"` }, { status: 400 })
  }

  const coiPath = cleanText(body.coi_storage_path)
  // Defense in depth: a COI path must live under this association's
  // insurance folder so a tampered client can't attach another assoc's
  // file (or escape the bucket prefix).
  if (coiPath && !coiPath.startsWith(`${upperCode}/insurance/`)) {
    return NextResponse.json({ error: 'coi_storage_path does not belong to this association' }, { status: 400 })
  }
  // Compress the browser-uploaded COI in place (signed-URL upload = raw).
  if (coiPath) {
    await normalizeStoredFile({ bucket: 'association-documents', path: coiPath, filename: coiPath.split('/').pop() ?? null })
      .then(r => { if (r.changed) console.log(`[insurance] normalized ${coiPath}: ${r.note}`) })
  }

  const waived = body.waived === true

  // Archive the prior active row for this (assoc, policy_type) FIRST so
  // the partial-unique active index (one active per assoc+type) holds
  // when we insert the new one.
  await supabaseAdmin
    .from('association_insurance_policies')
    .update({ archived_at: new Date().toISOString(), archived_by_email: actorEmail(session) })
    .eq('association_code', upperCode)
    .eq('policy_type', policyType)
    .is('archived_at', null)

  const { data: inserted, error } = await supabaseAdmin
    .from('association_insurance_policies')
    .insert({
      association_code:    upperCode,
      policy_type:         policyType,
      carrier:             cleanText(body.carrier),
      policy_number:       cleanText(body.policy_number),
      named_insured:       cleanText(body.named_insured),
      effective_date:      cleanDate(body.effective_date),
      expiration_date:     cleanDate(body.expiration_date),
      coverage_amount_usd: cleanNumber(body.coverage_amount_usd),
      premium_usd:         cleanNumber(body.premium_usd),
      agent_name:          cleanText(body.agent_name),
      agent_email:         cleanText(body.agent_email),
      agent_phone:         cleanText(body.agent_phone),
      coi_storage_path:    coiPath,
      coi_filename:        cleanText(body.coi_filename),
      coi_mime_type:       cleanText(body.coi_mime_type),
      coi_file_size_bytes: cleanNumber(body.coi_file_size_bytes),
      drive_url:           cleanUrl(body.drive_url),
      waived,
      waived_reason:       waived ? cleanText(body.waived_reason) : null,
      notes:               cleanText(body.notes),
      created_by_email:    actorEmail(session),
    })
    .select('*')
    .single()

  if (error) {
    // If the archive above raced (shouldn't, single request) the unique
    // index surfaces 23505 — report it cleanly.
    return NextResponse.json({ error: error.message }, { status: error.code === '23505' ? 409 : 500 })
  }

  return NextResponse.json({ ok: true, policy: inserted as AssociationInsurancePolicy })
}
