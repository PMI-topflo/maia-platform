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
import { normalizePhone } from '@/lib/cinc-sync'
import { mergeStakeholderInto } from '@/lib/stakeholder-merge'

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
  const cleanPhone = (v: unknown) => { const s = String(v ?? '').trim(); return s ? (normalizePhone(s) ?? s) : null }
  const raw: { name: string; role: string | null; email: string | null; phone: string | null }[] = Array.isArray(b.applicants)
    ? (b.applicants as unknown[]).map(a => { const o = (a ?? {}) as Record<string, unknown>; return { name: String(o.name ?? '').trim(), role: o.applicant_role && isApplicantRole(String(o.applicant_role)) ? String(o.applicant_role) : null, email: 'email' in o ? cleanEmail(o.email) : undefined as unknown as null, phone: 'phone' in o ? cleanPhone(o.phone) : undefined as unknown as null } })
    : Array.isArray(b.names) ? (b.names as unknown[]).map(n => ({ name: String(n ?? '').trim(), role: null, email: undefined as unknown as null, phone: undefined as unknown as null })) : []
  // Keep a row if it identifies SOMEBODY — a name, or an email, or a phone.
  //
  // It used to require a name, and further down anyone missing from this list
  // is DELETED. So an occupant the owner submitted with only an email was
  // dropped from the payload and then deleted from the roster on the next save
  // of any unrelated field. A person we hold an address for is a person; a
  // missing name is something to fill in, not grounds for removing them.
  //
  // De-dupe by name where there is one, else by email — two different people
  // with no name yet must not collapse into one row.
  const seen = new Set<string>()
  const dedupeKey = (r: { name: string; email: string | null }) => r.name ? `n:${norm(r.name)}` : `e:${(r.email ?? '').toLowerCase()}`
  const list = raw.filter(r => {
    if (!r.name && !r.email && !r.phone) return false
    const k = dedupeKey(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (list.length === 0) return NextResponse.json({ error: 'Add at least one applicant.' }, { status: 400 })

  const [{ data: existing }, { data: docRows }] = await Promise.all([
    supabaseAdmin.from('application_stakeholders')
      .select('id, name, email, phone, is_primary, signed_at, email_verified_at, created_at').eq('application_id', id).eq('role', 'applicant').order('created_at', { ascending: true }),
    supabaseAdmin.from('application_documents').select('stakeholder_id').eq('application_id', id).not('stakeholder_id', 'is', null),
  ])
  const docCount = new Map<string, number>()
  for (const d of docRows ?? []) { const k = String(d.stakeholder_id); docCount.set(k, (docCount.get(k) ?? 0) + 1) }
  // Two rows for the SAME person can exist (MANXI 903: "Shoodlyne Deus" twice
  // — one row holding her uploads, the other her Checkr payment). Prefer the
  // row that has the most attached to it as the one to keep; the other is
  // merged into it below, never deleted with its documents orphaned.
  const weight = (s: { id: unknown; signed_at?: unknown; email_verified_at?: unknown }) =>
    (docCount.get(String(s.id)) ?? 0) + (s.signed_at ? 100 : 0) + (s.email_verified_at ? 10 : 0)
  const ranked = [...(existing ?? [])].sort((a, b) => weight(b) - weight(a))
  const byName = new Map<string, typeof ranked[number]>()
  const byEmail = new Map<string, typeof ranked[number]>()
  const byPhone = new Map<string, typeof ranked[number]>()
  for (const s of ranked) {
    const n = norm(String(s.name ?? '')); if (n && !byName.has(n)) byName.set(n, s)
    const e = String(s.email ?? '').toLowerCase(); if (e && !byEmail.has(e)) byEmail.set(e, s)
    const p = String(s.phone ?? ''); if (p && !byPhone.has(p)) byPhone.set(p, s)
  }
  const keptIds = new Set<string>()
  const now = new Date().toISOString()

  for (let i = 0; i < list.length; i++) {
    const { name, role, email, phone } = list[i]
    const applicantRole = role ?? (i === 0 ? 'primary_applicant' : 'co_applicant')
    const contact: Record<string, unknown> = {}
    if (email !== undefined) contact.email = email
    if (phone !== undefined) contact.phone = phone
    // Match by name, else by email, else by phone — a person renamed in the
    // editor (typo fixed) must update their row, not spawn a second one.
    const hit = [
      name ? byName.get(norm(name)) : undefined,
      email ? byEmail.get(String(email).toLowerCase()) : undefined,
      phone ? byPhone.get(String(phone)) : undefined,
    ].find(h => h && !keptIds.has(String(h.id)))
    if (hit) {
      keptIds.add(String(hit.id))
      await supabaseAdmin.from('application_stakeholders').update({ name, is_primary: i === 0, applicant_role: applicantRole, ...contact, updated_at: now }).eq('id', hit.id)
    } else {
      await supabaseAdmin.from('application_stakeholders').insert({
        application_id: id, role: 'applicant', name, is_primary: i === 0, applicant_role: applicantRole, ...contact, status: 'active', added_by_role: 'staff',
      })
    }
  }

  // Remove applicants dropped from the list. A dropped row that is the same
  // person as a kept row (same name, email or phone) is MERGED into it —
  // documents, screening, answers move over — instead of deleted. Anyone
  // else who signed / verified is never deleted. Deletion errors used to be
  // swallowed here, which is how a duplicate card survived "Remove + Save".
  const warnings: string[] = []
  const kept = ranked.filter(s => keptIds.has(String(s.id)))
  const samePerson = (a: typeof ranked[number], b: typeof ranked[number]) =>
    (!!a.name && norm(String(a.name)) === norm(String(b.name ?? ''))) ||
    (!!a.email && String(a.email).toLowerCase() === String(b.email ?? '').toLowerCase()) ||
    (!!a.phone && String(a.phone) === String(b.phone ?? ''))
  for (const s of existing ?? []) {
    if (keptIds.has(String(s.id))) continue
    const twin = kept.find(k => samePerson(s, k))
    if (twin) {
      const r = await mergeStakeholderInto(id, String(s.id), String(twin.id))
      if (!r.ok) warnings.push(`Could not merge the duplicate "${s.name ?? s.email ?? ''}": ${r.error}`)
      continue
    }
    if (s.signed_at || s.email_verified_at) { warnings.push(`${s.name ?? s.email ?? 'A person'} has already signed or verified their email and was kept.`); continue }
    if (docCount.get(String(s.id))) {
      // Their uploads would become unowned shared files — refuse rather than lose track of whose they are.
      warnings.push(`${s.name ?? s.email ?? 'A person'} has ${docCount.get(String(s.id))} uploaded document(s) and was kept — remove or reassign their documents first.`)
      continue
    }
    const { error } = await supabaseAdmin.from('application_stakeholders').delete().eq('id', s.id)
    if (error) warnings.push(`Could not remove ${s.name ?? s.email ?? 'a person'}: ${error.message}`)
  }

  // Re-flag the On-Going folder now that the applicants are known (best-effort).
  void renameApplicationFolder(id).catch(() => null)

  return NextResponse.json({ ok: true, count: list.length, warnings })
}
