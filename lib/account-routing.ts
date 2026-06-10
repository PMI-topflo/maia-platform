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
  payByType:         string | null
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
    .select('account_number_norm, cinc_vendor_id, vendor_name, association_code, gl_account_id, gl_account_name, pay_by_type, source')
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
    payByType:         (data.pay_by_type as string | null) ?? null,
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
  payByType?:       string | null
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
    pay_by_type:         (opts.payByType ?? '').trim() || null,
    source:              opts.source ?? 'confirmed',
    confirmed_at:        opts.source === 'cinc_seed' ? null : now,
    confirmed_by:        opts.confirmedBy ?? null,
    updated_at:          now,
  }, { onConflict: 'account_number_norm' })
}

/** Look up a vendor's learned payment method (from the 12-month backfill). */
export async function lookupVendorMethod(cincVendorId: string | number | null | undefined): Promise<{ method: string; sampleCount: number } | null> {
  if (cincVendorId == null) return null
  const { data } = await supabaseAdmin
    .from('vendor_payment_methods')
    .select('pay_by_type, sample_count')
    .eq('cinc_vendor_id', String(cincVendorId))
    .maybeSingle()
  const method = (data?.pay_by_type as string | null) ?? null
  if (!method) return null
  return { method, sampleCount: (data?.sample_count as number) ?? 0 }
}

/** Backfill per-vendor payment methods from CINC. Reads every invoice for each
 *  active association over the last `months` (default 12) — each row carries
 *  PayByType + VendorID — aggregates the dominant method per vendor, and upserts
 *  vendor_payment_methods. One-time / occasional admin action. Best-effort. */
export async function backfillVendorPaymentMethods(opts?: { months?: number }): Promise<{ associations: number; invoices: number; vendors: number }> {
  const { listAssociationInvoices } = await import('@/lib/integrations/cinc')
  const months = Math.max(1, Math.min(opts?.months ?? 12, 24))
  const { data: assocs } = await supabaseAdmin.from('associations').select('association_code').eq('active', true)
  const codes = (assocs ?? []).map(a => (a.association_code as string | null)).filter(Boolean) as string[]

  // Date windows ≤ 11 months each (the endpoint caps the range at 366 days).
  const now = new Date()
  const windows: Array<{ from: string; to: string }> = []
  let cursor = now, remaining = months
  while (remaining > 0) {
    const chunk = Math.min(remaining, 11)
    const start = new Date(cursor.getFullYear(), cursor.getMonth() - chunk, cursor.getDate())
    windows.push({ from: start.toISOString().slice(0, 10), to: cursor.toISOString().slice(0, 10) })
    cursor = start; remaining -= chunk
  }

  const agg = new Map<string, { vendorName: string; counts: Map<string, number>; lastDate: string; lastMethod: string }>()
  let invoices = 0
  for (const code of codes) {
    for (const w of windows) {
      const rows = await listAssociationInvoices({ assocCode: code, fromDate: w.from, toDate: w.to }).catch(() => [])
      for (const r of rows) {
        const vid = r.VendorID != null ? String(r.VendorID) : null
        const pbt = (r.PayByType ?? '').trim()
        if (!vid || !pbt) continue
        invoices++
        let e = agg.get(vid)
        if (!e) { e = { vendorName: r.Vendor ?? '', counts: new Map(), lastDate: '', lastMethod: '' }; agg.set(vid, e) }
        e.counts.set(pbt, (e.counts.get(pbt) ?? 0) + 1)
        const d = (r.InvoiceDate ?? '').slice(0, 10)
        if (d && d > e.lastDate) { e.lastDate = d; e.lastMethod = pbt }
        if (r.Vendor) e.vendorName = r.Vendor
      }
    }
  }

  const stamp = new Date().toISOString()
  for (const [vid, e] of agg) {
    let dominant = '', bestN = -1, total = 0
    for (const [m, n] of e.counts) { total += n; if (n > bestN) { dominant = m; bestN = n } }
    await supabaseAdmin.from('vendor_payment_methods').upsert({
      cinc_vendor_id:    vid,
      vendor_name:       e.vendorName || null,
      pay_by_type:       dominant,
      sample_count:      total,
      last_invoice_date: e.lastDate || null,
      last_method:       e.lastMethod || null,
      updated_at:        stamp,
    }, { onConflict: 'cinc_vendor_id' }).then(() => null, () => null)
  }
  return { associations: codes.length, invoices, vendors: agg.size }
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
