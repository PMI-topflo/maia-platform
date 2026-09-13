// =====================================================================
// lib/payment-reconciliation.ts
//
// Application payments, reconciled three ways for one calendar month:
//   1. What applicants paid PMI through Stripe — gross, Stripe's own fee
//      and net, from each charge's balance transaction (never estimated).
//   2. Which Stripe payout carried that money to the bank, with Stripe's
//      arrival date and "paid" status — and Karen's tick that it landed.
//   3. What Checkr charged for the screenings — from the receipts Checkr
//      lets you download (one PDF per order), matched by the order id MAIA
//      already stores on every screening subject.
//
// Stripe is read live with the production key; nothing about Stripe is
// stored except the bank-received flag. User request, 2026-09-13.
// =====================================================================

import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2023-10-16' })
}

export interface ReconRow {
  applicationId: string
  association: string | null
  unit: string | null
  applicants: string[]
  chargeId: string | null
  chargeDate: string | null
  grossCents: number
  feeCents: number | null
  netCents: number | null
  payoutId: string | null
  payoutArrival: string | null
  payoutStatus: string | null
  bankReceivedAt: string | null
  bankReceivedBy: string | null
  reports: { name: string | null; orderId: string | null; orderedAt: string; status: string; receiptCents: number | null; receiptDate: string | null }[]
  checkrCents: number | null          // sum of matched receipts, null if none uploaded
  checkrExpectedCents: number         // reports × last known receipt price
  marginCents: number | null
}

export interface PayoutRow {
  id: string; amountCents: number; arrivalDate: string; status: string
  chargeIds: string[]; applications: number
  bankReceivedAt: string | null; bankReceivedBy: string | null; note: string | null
}

export interface Reconciliation {
  month: string
  rows: ReconRow[]
  payouts: PayoutRow[]
  summary: { collectedCents: number; feesCents: number; netCents: number; reports: number; checkrCents: number; checkrExpectedCents: number; marginCents: number; payoutsReceivedCents: number; payoutsPendingCents: number }
  exceptions: string[]
  unmatchedReceipts: { orderId: string; applicant: string | null; amountCents: number; paidOn: string | null }[]
  stripeConfigured: boolean
}

const monthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 1))
  return { start, end, startTs: Math.floor(start.getTime() / 1000), endTs: Math.floor(end.getTime() / 1000) }
}

export async function buildReconciliation(month: string): Promise<Reconciliation> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must be YYYY-MM')
  const { start, end, startTs, endTs } = monthBounds(month)
  const exceptions: string[] = []
  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY

  // ── Stripe: charges in the month, sessions → application, payouts ────
  type ChargeInfo = { id: string; created: number; gross: number; fee: number | null; net: number | null; paymentIntent: string | null; email: string | null }
  const charges = new Map<string, ChargeInfo>()
  const sessionByIntent = new Map<string, string>()
  const payoutByCharge = new Map<string, PayoutRow>()
  const payouts: PayoutRow[] = []
  if (stripeConfigured) {
    const s = stripe()
    for await (const c of s.charges.list({ created: { gte: startTs, lt: endTs }, limit: 100, expand: ['data.balance_transaction'] })) {
      if (c.status !== 'succeeded') continue
      const bt = typeof c.balance_transaction === 'object' && c.balance_transaction ? c.balance_transaction : null
      charges.set(c.id, { id: c.id, created: c.created, gross: c.amount_captured ?? c.amount, fee: bt?.fee ?? null, net: bt?.net ?? null, paymentIntent: typeof c.payment_intent === 'string' ? c.payment_intent : c.payment_intent?.id ?? null, email: c.billing_details?.email ?? c.receipt_email ?? null })
    }
    for await (const sess of s.checkout.sessions.list({ created: { gte: startTs - 7 * 86400, lt: endTs }, limit: 100 })) {
      const pi = typeof sess.payment_intent === 'string' ? sess.payment_intent : sess.payment_intent?.id
      if (pi) sessionByIntent.set(pi, sess.id)
    }
    // Payouts that could carry this month's charges: created from month start to 45 days after.
    const { data: flags } = await supabaseAdmin.from('stripe_payout_receipts').select('*')
    const flagBy = new Map((flags ?? []).map(f => [String(f.payout_id), f]))
    for await (const p of s.payouts.list({ created: { gte: startTs, lt: endTs + 45 * 86400 }, limit: 100 })) {
      if (p.status === 'canceled' || p.status === 'failed') continue
      const chargeIds: string[] = []
      for await (const bt of s.balanceTransactions.list({ payout: p.id, type: 'charge', limit: 100 })) {
        const src = typeof bt.source === 'string' ? bt.source : bt.source?.id
        if (src) chargeIds.push(src)
      }
      const f = flagBy.get(p.id)
      const row: PayoutRow = {
        id: p.id, amountCents: p.amount, arrivalDate: new Date(p.arrival_date * 1000).toISOString().slice(0, 10), status: p.status,
        chargeIds, applications: chargeIds.filter(id => charges.has(id)).length,
        bankReceivedAt: (f?.bank_received_at as string | null) ?? null, bankReceivedBy: (f?.bank_received_by as string | null) ?? null, note: (f?.note as string | null) ?? null,
      }
      if (row.applications > 0) { payouts.push(row); for (const id of chargeIds) payoutByCharge.set(id, row) }
    }
  } else exceptions.push('Stripe is not configured on this server — amounts come from MAIA only, fees and payouts are unknown.')

  // ── MAIA: applications paid in the month (live Stripe sessions only) ──
  const { data: apps } = await supabaseAdmin.from('applications')
    .select('id, association, applicants, stripe_session_id, stripe_payment_status, stripe_amount_paid, created_at')
    .not('stripe_session_id', 'is', null).like('stripe_session_id', 'cs_live_%')
    .gte('created_at', new Date(start.getTime() - 7 * 86400000).toISOString()).lt('created_at', end.toISOString())
  const appBySession = new Map((apps ?? []).map(a => [String(a.stripe_session_id), a]))
  const chargeByApp = new Map<string, ChargeInfo>()
  for (const c of charges.values()) {
    const sess = c.paymentIntent ? sessionByIntent.get(c.paymentIntent) : null
    const app = sess ? appBySession.get(sess) : null
    if (app) chargeByApp.set(String(app.id), c)
    else exceptions.push(`Stripe charge ${c.id} (${(c.gross / 100).toFixed(2)}, ${c.email ?? 'no email'}) is not linked to any application`)
  }

  const appIds = (apps ?? []).map(a => String(a.id))
  const [{ data: subs }, { data: receipts }] = await Promise.all([
    appIds.length ? supabaseAdmin.from('screening_subjects').select('application_id, name, checkr_order_id, status, created_at').in('application_id', appIds).order('created_at') : Promise.resolve({ data: [] as { application_id: string; name: string | null; checkr_order_id: string | null; status: string; created_at: string }[] }),
    supabaseAdmin.from('checkr_receipts').select('order_id, amount_cents, paid_on, applicant_name'),
  ])
  const receiptBy = new Map((receipts ?? []).map(r => [String(r.order_id), r]))
  const usedReceipts = new Set<string>()
  const lastPrice = (receipts ?? []).length ? Number((receipts ?? []).slice().sort((a, b) => String(b.paid_on ?? '').localeCompare(String(a.paid_on ?? '')))[0].amount_cents) : 3499

  const rows: ReconRow[] = []
  for (const a of apps ?? []) {
    const id = String(a.id)
    const c = chargeByApp.get(id) ?? null
    // Only applications with a live charge in this month (or, without Stripe, a paid status).
    if (stripeConfigured && !c) continue
    if (!stripeConfigured && a.stripe_payment_status !== 'paid') continue
    const applicants = (Array.isArray(a.applicants) ? a.applicants as { firstName?: string; lastName?: string; unitApplying?: string }[] : [])
    const unit = applicants.find(x => x.unitApplying)?.unitApplying ?? null
    const reports = (subs ?? []).filter(s => String(s.application_id) === id).map(s => {
      const r = s.checkr_order_id ? receiptBy.get(s.checkr_order_id) : null
      if (r) usedReceipts.add(String(r.order_id))
      return { name: s.name, orderId: s.checkr_order_id, orderedAt: String(s.created_at), status: String(s.status), receiptCents: r ? Number(r.amount_cents) : null, receiptDate: r ? String(r.paid_on ?? '') : null }
    })
    const checkrCents = reports.some(r => r.receiptCents != null) ? reports.reduce((n, r) => n + (r.receiptCents ?? 0), 0) : null
    const gross = c ? c.gross : Number(a.stripe_amount_paid ?? 0)
    const payout = c ? payoutByCharge.get(c.id) ?? null : null
    const net = c?.net ?? null
    rows.push({
      applicationId: id, association: (a.association as string | null) ?? null, unit,
      applicants: applicants.map(x => `${x.firstName ?? ''} ${x.lastName ?? ''}`.trim()).filter(Boolean),
      chargeId: c?.id ?? null, chargeDate: c ? new Date(c.created * 1000).toISOString() : String(a.created_at),
      grossCents: gross, feeCents: c?.fee ?? null, netCents: net,
      payoutId: payout?.id ?? null, payoutArrival: payout?.arrivalDate ?? null, payoutStatus: payout?.status ?? null,
      bankReceivedAt: payout?.bankReceivedAt ?? null, bankReceivedBy: payout?.bankReceivedBy ?? null,
      reports, checkrCents, checkrExpectedCents: reports.length * lastPrice,
      marginCents: net != null && checkrCents != null ? net - checkrCents : null,
    })
    if (!reports.length) exceptions.push(`${a.association ?? ''} unit ${unit ?? '?'}: paid ${(gross / 100).toFixed(2)} but no screening was ordered`)
    if (reports.some(r => r.orderId && r.receiptCents == null)) exceptions.push(`${a.association ?? ''} unit ${unit ?? '?'}: ${reports.filter(r => r.orderId && r.receiptCents == null).length} screening(s) without a Checkr receipt uploaded`)
  }
  rows.sort((a, b) => String(a.chargeDate).localeCompare(String(b.chargeDate)))

  const unmatchedReceipts = (receipts ?? []).filter(r => !usedReceipts.has(String(r.order_id)) && String(r.paid_on ?? '').startsWith(month))
    .map(r => ({ orderId: String(r.order_id), applicant: (r.applicant_name as string | null) ?? null, amountCents: Number(r.amount_cents), paidOn: (r.paid_on as string | null) ?? null }))
  for (const p of payouts) if (p.status === 'paid' && !p.bankReceivedAt && Date.now() - new Date(p.arrivalDate).getTime() > 7 * 86400000) exceptions.push(`Payout ${p.id} (${(p.amountCents / 100).toFixed(2)}, arrived ${p.arrivalDate}) not yet marked received in the bank`)

  const sum = (f: (r: ReconRow) => number | null) => rows.reduce((n, r) => n + (f(r) ?? 0), 0)
  const summary = {
    collectedCents: sum(r => r.grossCents), feesCents: sum(r => r.feeCents), netCents: sum(r => r.netCents),
    reports: rows.reduce((n, r) => n + r.reports.length, 0), checkrCents: sum(r => r.checkrCents), checkrExpectedCents: sum(r => r.checkrExpectedCents),
    marginCents: sum(r => r.marginCents),
    payoutsReceivedCents: payouts.filter(p => p.bankReceivedAt).reduce((n, p) => n + p.amountCents, 0),
    payoutsPendingCents: payouts.filter(p => !p.bankReceivedAt).reduce((n, p) => n + p.amountCents, 0),
  }
  return { month, rows, payouts, summary, exceptions, unmatchedReceipts, stripeConfigured }
}

/** Karen's tick: this payout landed in the bank (or un-tick). */
export async function markPayoutReceived(payoutId: string, received: boolean, by: string, note?: string | null): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('stripe_payout_receipts').upsert({
    payout_id: payoutId, bank_received_at: received ? now : null, bank_received_by: received ? by : null, note: note ?? null, updated_at: now,
  }, { onConflict: 'payout_id' })
  if (error) throw new Error(error.message)
}

/** Parse one Checkr receipt PDF's text. Format (2026-09): "Order: ord_…",
 *  "Sep 11, 2026 at 00:23 UTC", PROPERTY / APPLICANT blocks, "AMOUNT PAID
 *  $34.99", a package line. Returns null when it is not a Checkr receipt. */
export function parseCheckrReceipt(text: string): { orderId: string; amountCents: number; paidOn: string | null; applicantName: string | null; applicantEmail: string | null; property: string | null; pkg: string | null } | null {
  const order = /Order:\s*(ord_[A-Za-z0-9_-]+)/.exec(text)
  if (!order) return null
  const amt = /AMOUNT PAID\s*\$?\s*([\d,]+\.\d{2})/i.exec(text) ?? /Total\s*\$?\s*([\d,]+\.\d{2})/i.exec(text)
  const amountCents = amt ? Math.round(Number(amt[1].replace(/,/g, '')) * 100) : 0
  const date = /Card\s*·\s*([A-Z][a-z]{2} \d{1,2}, \d{4})/.exec(text) ?? /([A-Z][a-z]{2} \d{1,2}, \d{4}) at \d{2}:\d{2} UTC/.exec(text)
  const paidOn = date ? new Date(date[1] + ' 12:00:00 UTC').toISOString().slice(0, 10) : null
  const email = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(text.replace(/hello-tenant@checkr\.com/g, ''))
  const applicant = /APPLICANT\s+([^\n]+)\n/.exec(text)
  const property = /PROPERTY\s+([^\n]+)\n([^\n]+)\n/.exec(text)
  const pkg = /([A-Za-z ]+package)/i.exec(text)
  return {
    orderId: order[1], amountCents, paidOn,
    applicantName: applicant ? applicant[1].trim() : null, applicantEmail: email ? email[1].toLowerCase() : null,
    property: property ? `${property[1].trim()}, ${property[2].trim()}` : null, pkg: pkg ? pkg[1].trim() : null,
  }
}

export async function storeCheckrReceipt(parsed: NonNullable<ReturnType<typeof parseCheckrReceipt>>, filename: string, by: string): Promise<'matched' | 'unmatched'> {
  const { error } = await supabaseAdmin.from('checkr_receipts').upsert({
    order_id: parsed.orderId, amount_cents: parsed.amountCents, paid_on: parsed.paidOn, applicant_name: parsed.applicantName, applicant_email: parsed.applicantEmail,
    property: parsed.property, package: parsed.pkg, filename, uploaded_by: by, uploaded_at: new Date().toISOString(),
  }, { onConflict: 'order_id' })
  if (error) throw new Error(error.message)
  const { data } = await supabaseAdmin.from('screening_subjects').select('id').eq('checkr_order_id', parsed.orderId).limit(1)
  return data?.length ? 'matched' : 'unmatched'
}
