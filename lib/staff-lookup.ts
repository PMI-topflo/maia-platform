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
// Migration tolerance: this file does NOT reference the alt_emails
// column at SELECT or WHERE level for the primary match, so it keeps
// working even if the alt_emails migration hasn't been applied yet.
// A secondary query attempts the alt_emails lookup and silently
// degrades to no-op when the column is missing. Once the migration
// is applied that secondary query lights up automatically.
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
const BASE_COLS       = 'id, name, email, personal_email, active'

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Try to fetch alt_emails for a known staff id. Returns [] if the
 *  column doesn't exist yet (pre-migration) — silent degradation. */
async function fetchAltEmails(id: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('pmi_staff')
    .select('alt_emails')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return []
  const v = (data as { alt_emails?: unknown }).alt_emails
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Same local-part across every trusted PMI work domain. Staff use
 *  <name>@topfloridaproperties.com and <name>@pmitop.com (and mypmitop.com)
 *  interchangeably for the same person, so any one address implies the
 *  others. Non-PMI domains (e.g. a personal gmail) pass through unchanged.
 *  This is what makes "my tickets" match whether the assignee was recorded
 *  under either domain — without needing alt_emails populated. */
export function trustedDomainVariants(email: string | null | undefined): string[] {
  const e = lower(email)
  const at = e.indexOf('@')
  if (at < 1) return e ? [e] : []
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  if (!TRUSTED_DOMAINS.has(domain)) return [e]
  return [...TRUSTED_DOMAINS].map(d => `${local}@${d}`)
}

/** All email addresses tied to this staff record, expanded across the
 *  trusted PMI domains. Used to build the candidate list when filtering
 *  tickets by assignee_email. The loginEmail is included even if it's not
 *  stored on the row (covers the name-derived alias case). */
export function staffCandidateEmails(row: StaffRow, loginEmail: string): string[] {
  const out = new Set<string>()
  const add = (v: string | null | undefined) => { for (const variant of trustedDomainVariants(v)) out.add(variant) }
  add(row.email)
  add(row.personal_email)
  for (const a of (row.alt_emails ?? [])) add(a)
  add(loginEmail)
  return [...out].filter(Boolean)
}

/** Resolve a single active pmi_staff row that the given login email
 *  should be allowed to act as. Returns null if no row matches or if
 *  the name-derived fallback turned up multiple candidates. */
export async function resolveStaffByLoginEmail(loginEmail: string): Promise<StaffRow | null> {
  const id = lower(loginEmail)
  if (!id || !id.includes('@')) return null

  // 1a. Exact match on the always-present columns (email / personal_email).
  //     Kept separate from alt_emails so a missing migration doesn't break
  //     the primary path — the user's row is still findable via these.
  const { data: byEmail } = await supabaseAdmin
    .from('pmi_staff')
    .select(BASE_COLS)
    .or(`email.ilike.${id},personal_email.ilike.${id}`)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (byEmail) return await attachAltEmails(byEmail as StaffRow)

  // 1b. Exact match against alt_emails. Skipped silently if the column
  //     doesn't exist yet (migration pending) — the Supabase client
  //     returns an error which we ignore in favor of falling through.
  const { data: byAlt } = await supabaseAdmin
    .from('pmi_staff')
    .select(BASE_COLS)
    .contains('alt_emails', [id])
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (byAlt) return await attachAltEmails(byAlt as StaffRow)

  // 2. Name-derived fallback. Only applies on trusted PMI work domains.
  const [local, domain] = id.split('@', 2)
  if (!domain || !TRUSTED_DOMAINS.has(domain)) return null
  const tokens = local.split(/[._-]+/).filter(t => t.length >= 2)
  if (tokens.length === 0) return null

  // Pull every active row that contains the first token in its name —
  // small staff team, fine to filter in-app for an unambiguous match.
  const { data: candidates } = await supabaseAdmin
    .from('pmi_staff')
    .select(BASE_COLS)
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
  return await attachAltEmails(filtered[0] as StaffRow)
}

/** Decorate a row from the BASE_COLS select with its alt_emails (best-
 *  effort — pre-migration this returns []). */
async function attachAltEmails(row: StaffRow): Promise<StaffRow> {
  const alt = await fetchAltEmails(row.id)
  return { ...row, alt_emails: alt }
}
