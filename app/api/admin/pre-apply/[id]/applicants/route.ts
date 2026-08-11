// GET  /api/admin/pre-apply/[id]/applicants?propose=1
//        → { proposed: string[], current: {id,name}[] }  reads the saved lease and
//          proposes the applicant names (extractLeaseDetails); returns the roster.
// POST /api/admin/pre-apply/[id]/applicants   { names: string[] }
//        → replaces the applicant roster (application_stakeholders, role 'applicant').
//          Signed / email-verified applicants are never deleted. Staff-only.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireStaffSession } from '@/lib/staff-auth'
import { INTAKE_BUCKET, isApplicantRole } from '@/lib/preapply'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { renameApplicationFolder } from '@/lib/drive-application-mirror'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const [{ data: current }, { data: lease }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders').select('id, name, is_primary, applicant_role, email, phone').eq('application_id', id).eq('role', 'applicant').order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabaseAdmin.from('application_documents').select('storage_path, mime_type').eq('application_id', id).eq('doc_key', 'signed_lease').maybeSingle(),
  ])

  let proposed: string[] = []
  let proposedEmail: string | null = null, proposedPhone: string | null = null
  if (new URL(req.url).searchParams.get('propose') && lease?.storage_path) {
    const { data: blob } = await supabaseAdmin.storage.from(INTAKE_BUCKET).download(String(lease.storage_path))
    if (blob) {
      const d = await extractLeaseDetails(Buffer.from(await blob.arrayBuffer()), (lease.mime_type as string | null) ?? null).catch(() => null)
      proposed = d?.tenantNames ?? []
      proposedEmail = d?.tenantEmail ?? null
      proposedPhone = d?.tenantPhone ?? null
    }
  }

  return NextResponse.json({
    hasLease: !!lease?.storage_path,
    current: (current ?? []).map(s => ({ id: String(s.id), name: (s.name as string | null) ?? '', applicant_role: (s.applicant_role as string | null) ?? null, email: (s.email as string | null) ?? null, phone: (s.phone as string | null) ?? null })),
    proposed, proposedEmail, proposedPhone,
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { data: app } = await supabaseAdmin.from('listing_applications').select('id, listing_id').eq('id', id).maybeSingle()
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let b: { names?: unknown; applicants?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  // Accept { applicants: [{name, applicant_role, email, phone}] } or older { names: [] }.
  const cleanEmail = (v: unknown) => { const s = String(v ?? '').trim(); return s.includes('@') ? s : null }
  const cleanPhone = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
  const raw: { name: string; role: string | null; email: string | null; phone: string | null }[] = Array.isArray(b.applicants)
    ? (b.applicants as unknown[]).map(a => { const o = (a ?? {}) as Record<string, unknown>; return { name: String(o.name ?? '').trim(), role: o.applicant_role && isApplicantRole(String(o.applicant_role)) ? String(o.applicant_role) : null, email: 'email' in o ? cleanEmail(o.email) : undefined as unknown as null, phone: 'phone' in o ? cleanPhone(o.phone) : undefined as unknown as null } })
    : Array.isArray(b.names) ? (b.names as unknown[]).map(n => ({ name: String(n ?? '').trim(), role: null, email: undefined as unknown as null, phone: undefined as unknown as null })) : []
  // De-dupe by name, keep first occurrence.
  const seen = new Set<string>()
  const list = raw.filter(r => r.name && !seen.has(norm(r.name)) && seen.add(norm(r.name)))
  if (list.length === 0) return NextResponse.json({ error: 'Add at least one applicant.' }, { status: 400 })

  const { data: existing } = await supabaseAdmin.from('application_stakeholders')
    .select('id, name, is_primary, signed_at, email_verified_at').eq('application_id', id).eq('role', 'applicant')
  const byName = new Map((existing ?? []).map(s => [norm(String(s.name ?? '')), s]))
  const keptIds = new Set<string>()
  const now = new Date().toISOString()

  for (let i = 0; i < list.length; i++) {
    const { name, role, email, phone } = list[i]
    const applicantRole = role ?? (i === 0 ? 'primary_applicant' : 'co_applicant')
    const contact: Record<string, unknown> = {}
    if (email !== undefined) contact.email = email
    if (phone !== undefined) contact.phone = phone
    const hit = byName.get(norm(name))
    if (hit) {
      keptIds.add(String(hit.id))
      await supabaseAdmin.from('application_stakeholders').update({ name, is_primary: i === 0, applicant_role: applicantRole, ...contact, updated_at: now }).eq('id', hit.id)
    } else {
      await supabaseAdmin.from('application_stakeholders').insert({
        application_id: id, role: 'applicant', name, is_primary: i === 0, applicant_role: applicantRole, ...contact, status: 'active', added_by_role: 'staff',
      })
    }
  }

  // Remove applicants dropped from the list — but never one who signed / verified.
  for (const s of existing ?? []) {
    if (keptIds.has(String(s.id))) continue
    if (s.signed_at || s.email_verified_at) continue
    await supabaseAdmin.from('application_stakeholders').delete().eq('id', s.id)
  }

  // Re-flag the On-Going folder now that the applicants are known (best-effort).
  void renameApplicationFolder(id).catch(() => null)

  return NextResponse.json({ ok: true, count: list.length })
}
