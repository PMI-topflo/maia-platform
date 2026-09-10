// =====================================================================
// lib/board-roster.ts
//
// Who is on a board RIGHT NOW. Two tables exist:
//   association_board_members — the CINC-synced roster. Maintained. Has
//                                 name / email / role / active / substitute.
//                                 No phone. THIS is the authority.
//   board_members             — legacy. Unmaintained: ex-members still
//                                 "active", titles a term out of date. Has
//                                 phone + language, which the roster lacks.
//
// Real symptom, 2026-09-10 (MANXI): a review round emailed Jorge Manzano,
// inactive on the roster, because the sender read the legacy table. The
// emailing paths were fixed first (#863); this helper finishes the job for
// identity — login, "who is texting/calling", stats — so an ex-member can't
// be recognised as board anywhere. User direction: "fix it anyway", they
// will also Remove ex-members from the roster page.
//
// Phone identification still needs the legacy table's phone column, so a
// phone match is only accepted when the SAME email is active on the roster.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface RosterMember {
  /** association_board_members.id (uuid) — the id sessions carry. */
  id: string
  association_code: string
  name: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string | null
  /** From the legacy phone book, when a phone match led here. */
  phone: string | null
  language: string | null
}

function shape(r: { id: unknown; association_code: unknown; name: unknown; email: unknown; role: unknown }, extra?: { phone?: string | null; language?: string | null }): RosterMember {
  const name = String(r.name ?? '').trim()
  const [first, ...rest] = name.split(/\s+/)
  return {
    id: String(r.id), association_code: String(r.association_code), name,
    first_name: first || null, last_name: rest.length ? rest.join(' ') : null,
    email: (r.email as string | null) ?? null, role: (r.role as string | null) ?? null,
    phone: extra?.phone ?? null, language: extra?.language ?? null,
  }
}

/** Active roster members whose email (or active substitute's email) matches.
 *  `code` narrows to one association; omit to search all. */
export async function activeBoardByEmail(email: string, code?: string | null): Promise<RosterMember[]> {
  const e = email.trim().toLowerCase()
  if (!e.includes('@')) return []
  let q = supabaseAdmin.from('association_board_members')
    .select('id, association_code, name, email, role, substitute_name, substitute_email, substitute_active')
    .eq('active', true).or(`email.ilike.${e},and(substitute_active.eq.true,substitute_email.ilike.${e})`)
  if (code) q = q.eq('association_code', code.toUpperCase())
  const { data } = await q.limit(10)
  return (data ?? []).map(r => {
    // Logging in as the active substitute: same seat, the substitute's name.
    const asSub = !!r.substitute_active && String(r.substitute_email ?? '').toLowerCase() === e
    return shape(asSub ? { ...r, name: r.substitute_name ?? r.name, email: r.substitute_email } : r)
  })
}

/** Active roster members reachable at one of these phone forms. The phone
 *  lives only in the legacy table; a legacy row counts only when its email
 *  is an ACTIVE roster member's — an ex-member's phone no longer matches. */
export async function activeBoardByPhone(phones: string[], code?: string | null): Promise<RosterMember[]> {
  const variants = [...new Set(phones.map(p => p.trim()).filter(Boolean))]
  if (!variants.length) return []
  let q = supabaseAdmin.from('board_members').select('email, phone, language, association_code')
    .or(variants.map(p => `phone.eq.${p}`).join(','))
  if (code) q = q.eq('association_code', code.toUpperCase())
  const { data: legacy } = await q.limit(10)
  const out: RosterMember[] = []
  for (const l of legacy ?? []) {
    const email = String(l.email ?? '')
    if (!email.includes('@')) continue
    const matches = await activeBoardByEmail(email, String(l.association_code ?? code ?? ''))
    for (const m of matches) out.push({ ...m, phone: (l.phone as string | null) ?? null, language: (l.language as string | null) ?? null })
  }
  const seen = new Set<string>()
  return out.filter(m => !seen.has(m.id) && seen.add(m.id))
}

/** Legacy phone lookup by digit fragment (the login lookup used ilike). */
export async function activeBoardByPhoneFragment(digits: string, code?: string | null): Promise<RosterMember[]> {
  if (digits.length < 7) return []
  let q = supabaseAdmin.from('board_members').select('email, phone, language, association_code').ilike('phone', `%${digits}%`)
  if (code) q = q.eq('association_code', code.toUpperCase())
  const { data: legacy } = await q.limit(10)
  const out: RosterMember[] = []
  for (const l of legacy ?? []) {
    const email = String(l.email ?? '')
    if (!email.includes('@')) continue
    const matches = await activeBoardByEmail(email, String(l.association_code ?? code ?? ''))
    for (const m of matches) out.push({ ...m, phone: (l.phone as string | null) ?? null, language: (l.language as string | null) ?? null })
  }
  const seen = new Set<string>()
  return out.filter(m => !seen.has(m.id) && seen.add(m.id))
}

/** Add a board member the way staff do from the admin (Add person /
 *  pending-approvals): the roster row is the identity; the legacy table
 *  keeps the phone, which the roster has no column for. */
export async function addBoardMember(input: { association_code: string; first_name: string; last_name: string; email: string | null; phone: string | null; position: string | null }): Promise<{ error?: string }> {
  const name = `${input.first_name} ${input.last_name}`.trim()
  const { error } = await supabaseAdmin.from('association_board_members').insert({
    association_code: input.association_code.toUpperCase(), name, email: input.email ?? '', role: input.position, active: true, sort_order: 99,
  })
  if (error) return { error: error.message }
  if (input.phone) {
    await supabaseAdmin.from('board_members').insert({
      first_name: input.first_name, last_name: input.last_name, email: input.email, phone: input.phone,
      association_code: input.association_code.toUpperCase(), position: input.position, active: true,
    })
  }
  return {}
}
