// =====================================================================
// lib/staff-list.ts
// Resolves the unified staff list used by the ticket dashboard's
// assignee picker. Merges two sources:
//
//   1. pmi_staff (rich data: name + role)
//   2. staff_gmail_accounts (broader coverage: every connected inbox)
//
// Either query failing must not crash the caller — the page must keep
// rendering even with an empty staff list. Entries are deduped by
// lowercased email; pmi_staff wins on conflict so its Name/Role show.
// =====================================================================

import { supabaseAdmin } from './supabase-admin'

export interface StaffMember {
  name:  string
  email: string
  role:  string | null
}

export async function fetchStaffList(): Promise<StaffMember[]> {
  const out: StaffMember[] = []
  const seen = new Set<string>()

  // 1. pmi_staff — name + role
  try {
    const { data, error } = await supabaseAdmin
      .from('pmi_staff')
      .select('name, email, role')
      .eq('active', true)
      .order('name')
    if (!error && data) {
      for (const r of data as Array<{ name: string; email: string; role: string | null }>) {
        if (!r.email) continue
        const key = r.email.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ name: r.name, email: key, role: r.role })
      }
    }
  } catch (err) {
    console.warn('[staff-list] pmi_staff fetch failed:', err instanceof Error ? err.message : err)
  }

  // 2. staff_gmail_accounts — fill in addresses pmi_staff doesn't have.
  //    Display name is derived from the email local-part since this table
  //    only stores addresses.
  try {
    const { data } = await supabaseAdmin
      .from('staff_gmail_accounts')
      .select('gmail_address')
      .eq('active', true)
      .order('gmail_address')
    for (const r of (data ?? []) as Array<{ gmail_address: string }>) {
      if (!r.gmail_address) continue
      const key = r.gmail_address.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        name:  r.gmail_address.split('@')[0],
        email: key,
        role:  null,
      })
    }
  } catch (err) {
    console.warn('[staff-list] staff_gmail_accounts fetch failed:', err instanceof Error ? err.message : err)
  }

  return out
}
