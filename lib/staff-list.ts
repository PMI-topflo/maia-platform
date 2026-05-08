// =====================================================================
// lib/staff-list.ts
// Resolves the unified staff list used by the ticket dashboard's
// assignee picker. Reads pmi_staff first (has names + roles); if that
// table is missing or empty, falls back to staff_gmail_accounts (just
// emails). Either query failing must not crash the caller — the page
// must keep rendering even with an empty staff list.
// =====================================================================

import { supabaseAdmin } from './supabase-admin'

export interface StaffMember {
  name:  string
  email: string
  role:  string | null
}

export async function fetchStaffList(): Promise<StaffMember[]> {
  // Try pmi_staff first — richer data (name + role). Catch any error
  // (missing table, missing column, RLS, etc.) and fall through.
  try {
    const { data, error } = await supabaseAdmin
      .from('pmi_staff')
      .select('name, email, role')
      .eq('active', true)
      .order('name')
    if (!error && data && data.length > 0) {
      return (data as StaffMember[]).filter(s => s.email)
    }
  } catch (err) {
    console.warn('[staff-list] pmi_staff fetch failed:', err instanceof Error ? err.message : err)
  }

  // Fallback: connected Gmail accounts. Less context (no role, derive
  // a display name from the address) but always present.
  try {
    const { data } = await supabaseAdmin
      .from('staff_gmail_accounts')
      .select('gmail_address')
      .eq('active', true)
      .order('gmail_address')
    return (data ?? [])
      .filter(r => r.gmail_address)
      .map(r => ({
        name:  r.gmail_address.split('@')[0],
        email: r.gmail_address,
        role:  null,
      }))
  } catch (err) {
    console.warn('[staff-list] staff_gmail_accounts fallback failed:', err instanceof Error ? err.message : err)
    return []
  }
}
