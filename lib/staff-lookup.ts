// =====================================================================
// lib/staff-lookup.ts
// Canonical pmi_staff resolution by an arbitrary login email. Wraps
// every lookup variant in one place so verify-otp, check-session, the
// Control Panel "my tasks" filter, and the my-roles endpoint all
// agree on what counts as "this is the same person".
//
// Two strategies, tried in order:
//
//   1. EXACT match — a row where the lowercased login matches
//      email, personal_email, or any value in alt_emails.
//
//   2. NAME-DERIVED ALIAS — for logins like jane@pmitop.com,
//      jane.doe@topfloridaproperties.com, or first.last@pmitop.com.
//      The domain has to be one of the trusted PMI work domains;
//      then we split the local-part on '.' or '_' and look for an
//      active staff row whose `name` includes those tokens. We
//      require an unambiguous single match — if two staff share a
//      first name we want to fall through to "no match" rather than
//      pick the wrong person.
//
// The OTP still gates everything: the code is emailed to whatever
// the user typed, so even if the resolver matches "Jane Doe" by
// name, only someone with mailbox access to jane@pmitop.com can
// complete the login. The resolver only decides *which* staff row
// the session belongs to once that OTP succeeds.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface StaffRow {
  id:             string
  name:           string | null
  email:          string | null
  personal_email: string | null
  alt_emails:     string[] | null
  active?:        boolean | null
}

const TRUSTED_DOMAINS = new Set(['pmitop.com', 'topfloridaproperties.com', 'mypmitop.com'])

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** All email addresses tied to this staff record. Useful for building
 *  the candidate list when filtering tickets by assignee_email. The
 *  loginEmail passed in is included even if it's not stored on the row
 *  (covers the name-derived alias case where the row has no direct
 *  reference to the address the user actually typed). */
export function staffCandidateEmails(row: StaffRow, loginEmail: string): string[] {
  const out = new Set<string>()
  if (row.email)          out.add(lower(row.email))
  if (row.personal_email) out.add(lower(row.personal_email))
  for (const a of (row.alt_emails ?? [])) {
    const v = lower(a)
    if (v) out.add(v)
  }
  const login = lower(loginEmail)
  if (login) out.add(login)
  return [...out].filter(Boolean)
}

/** Resolve a single active pmi_staff row that the given login email
 *  should be allowed to act as. Returns null if no row matches or if
 *  the name-derived fallback turned up multiple candidates. */
export async function resolveStaffByLoginEmail(loginEmail: string): Promise<StaffRow | null> {
  const id = lower(loginEmail)
  if (!id || !id.includes('@')) return null

  // 1. Exact match on email / personal_email / alt_emails.
  const { data: exact } = await supabaseAdmin
    .from('pmi_staff')
    .select('id, name, email, personal_email, alt_emails, active')
    .or(`email.ilike.${id},personal_email.ilike.${id},alt_emails.cs.{${id}}`)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (exact) return exact as StaffRow

  // 2. Name-derived fallback. Only applies on trusted PMI work domains.
  const [local, domain] = id.split('@', 2)
  if (!domain || !TRUSTED_DOMAINS.has(domain)) return null
  const tokens = local.split(/[._-]+/).filter(t => t.length >= 2)
  if (tokens.length === 0) return null

  // Pull every active row that contains the first token in its name —
  // small staff team, fine to filter in-app for an unambiguous match.
  const { data: candidates } = await supabaseAdmin
    .from('pmi_staff')
    .select('id, name, email, personal_email, alt_emails, active')
    .ilike('name', `%${tokens[0]}%`)
    .eq('active', true)
    .limit(10)
  if (!candidates || candidates.length === 0) return null

  // If the local part has multiple tokens (first.last), require all of
  // them to appear in the candidate's name. If just one token (jane),
  // any row containing it counts — but we still want exactly one match.
  const filtered = candidates.filter(c => {
    const nameLower = lower(c.name)
    return tokens.every(t => nameLower.includes(t))
  })
  if (filtered.length !== 1) return null
  return filtered[0] as StaffRow
}
