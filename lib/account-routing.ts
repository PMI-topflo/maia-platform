// =====================================================================
// lib/account-routing.ts
//
// Account-number routing for utility / recurring invoices. The account
// number printed on a bill (FPL, water, Xfinity, …) is unique to a
// service location, so it resolves the correct CINC vendor + association
// + GL far more reliably than fuzzy vendor-name matching (which can't
// tell Xfinity from Comcast Business).
//
// The map (public.utility_account_routes) is:
//   • seeded from CINC vendor/{id}/accounts where CINC stores the number;
//   • learned from confirmed invoices on push (covers vendors CINC has no
//     account number for, e.g. Xfinity).
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface AccountRoute {
  accountNumberNorm: string
  cincVendorId:      string | null
  vendorName:        string | null
  associationCode:   string | null
  glAccountId:       string | null
  glAccountName:     string | null
  source:            string
}

// Account numbers shorter than this (after stripping separators) are too
// ambiguous to route on — avoids garbage extractions ("June", "1") colliding.
const MIN_NORM_LEN = 6

/** Normalize an account number to a stable match key: alphanumerics only,
 *  uppercased. "85279-85340" → "8527985340"; "8495 75 317 0246788" →
 *  "8495753170246788". Returns null when too short to route on. */
export function normalizeAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const norm = raw.replace(/[^0-9a-z]/gi, '').toUpperCase()
  return norm.length >= MIN_NORM_LEN ? norm : null
}

/** Look up the route for an account number. Returns null when unknown. */
export async function lookupAccountRoute(rawAccountNumber: string | null | undefined): Promise<AccountRoute | null> {
  const norm = normalizeAccountNumber(rawAccountNumber)
  if (!norm) return null
  const { data } = await supabaseAdmin
    .from('utility_account_routes')
    .select('account_number_norm, cinc_vendor_id, vendor_name, association_code, gl_account_id, gl_account_name, source')
    .eq('account_number_norm', norm)
    .maybeSingle()
  if (!data) return null
  return {
    accountNumberNorm: data.account_number_norm as string,
    cincVendorId:      (data.cinc_vendor_id as string | null) ?? null,
    vendorName:        (data.vendor_name as string | null) ?? null,
    associationCode:   (data.association_code as string | null) ?? null,
    glAccountId:       (data.gl_account_id as string | null) ?? null,
    glAccountName:     (data.gl_account_name as string | null) ?? null,
    source:            (data.source as string) ?? 'confirmed',
  }
}

/** Record (upsert) a route. Confirmed invoices call this on push so the map
 *  learns; the CINC seed passes source:'cinc_seed' + onlyIfAbsent so it never
 *  clobbers a human-confirmed route. */
export async function recordAccountRoute(opts: {
  rawAccountNumber: string | null | undefined
  cincVendorId?:    string | null
  vendorName?:      string | null
  associationCode?: string | null
  glAccountId?:     string | null
  glAccountName?:   string | null
  source?:          'confirmed' | 'cinc_seed'
  confirmedBy?:     string | null
  /** Skip if a route already exists for this number (used by the seed so it
   *  never overwrites a learned/confirmed route). */
  onlyIfAbsent?:    boolean
}): Promise<void> {
  const norm = normalizeAccountNumber(opts.rawAccountNumber)
  if (!norm) return
  if (opts.onlyIfAbsent) {
    const { data } = await supabaseAdmin
      .from('utility_account_routes').select('account_number_norm').eq('account_number_norm', norm).maybeSingle()
    if (data) return
  }
  const now = new Date().toISOString()
  await supabaseAdmin.from('utility_account_routes').upsert({
    account_number_norm: norm,
    account_number_raw:  (opts.rawAccountNumber ?? '').trim() || null,
    cinc_vendor_id:      opts.cincVendorId ?? null,
    vendor_name:         opts.vendorName ?? null,
    association_code:    opts.associationCode ? opts.associationCode.toUpperCase() : null,
    gl_account_id:       opts.glAccountId ?? null,
    gl_account_name:     opts.glAccountName ?? null,
    source:              opts.source ?? 'confirmed',
    confirmed_at:        opts.source === 'cinc_seed' ? null : now,
    confirmed_by:        opts.confirmedBy ?? null,
    updated_at:          now,
  }, { onConflict: 'account_number_norm' })
}

/** Seed routes from CINC's vendor/{id}/accounts for utility vendors. CINC
 *  stores the real account number for FPL (all assocs), water, etc. — pull it
 *  in so common accounts route from day one. Never clobbers confirmed routes.
 *  Best-effort; returns counts. */
export async function seedAccountRoutesFromCinc(): Promise<{ vendorsScanned: number; routesSeeded: number }> {
  const { listVendorsFull, listVendorAccounts } = await import('@/lib/integrations/cinc')
  const vendors = await listVendorsFull().catch(() => [])
  // Only utility-type vendors carry per-account numbers worth routing on.
  const utils = vendors.filter(v =>
    (v.VendorType ?? '').toLowerCase().includes('utilit') ||
    /\bfpl\b|florida power|water|sewer|electric|\bgas\b|comcast|xfinity|stormwater|sanitation/i.test(v.VendorName ?? ''),
  )
  let routesSeeded = 0
  for (const v of utils) {
    const accts = await listVendorAccounts(v.VendorId).catch(() => [])
    for (const a of accts) {
      if (!a.accountNumber || !a.assocCode) continue
      if (!normalizeAccountNumber(a.accountNumber)) continue
      await recordAccountRoute({
        rawAccountNumber: a.accountNumber,
        cincVendorId:     String(v.VendorId),
        vendorName:       v.VendorName,
        associationCode:  a.assocCode,
        glAccountName:    a.glAccount,   // CINC GL number, e.g. "58-5500-00"
        source:           'cinc_seed',
        onlyIfAbsent:     true,
      }).then(() => { routesSeeded++ }, () => null)
    }
  }
  return { vendorsScanned: utils.length, routesSeeded }
}
