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

// Lookup a staff member by their PERSONAL mobile number — the number they
// actually text Maia from. Used by the Twilio webhook to gate staff-only
// actions (explicit ticket / work-order creation). Matches on the last
// 10 digits so Twilio's E.164 format and any locally-stored formatting
// agree. Returns null if no match — caller treats that as "not staff"
// and skips the gated action.
export async function findStaffByPhone(phone: string | null | undefined): Promise<StaffMember | null> {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length < 10) return null
  try {
    const { data, error } = await supabaseAdmin
      .from('pmi_staff')
      .select('name, email, role')
      .eq('personal_phone_digits', digits)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (error || !data || !data.email) return null
    return data as StaffMember
  } catch (err) {
    console.warn('[staff-list] findStaffByPhone failed:', err instanceof Error ? err.message : err)
    return null
  }
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
