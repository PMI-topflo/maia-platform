// =====================================================================
// GET /api/admin/invoices/intake/vendor-context?vendorId=&assoc=&vendorName=
//
// Powers the AP audit checklist's smart hints:
//   • suggestedGl  — the GL account this vendor is normally booked to for
//     this association (CINC vendor/{id}/accounts).
//   • recentPayments — the vendor's last ~5 payments at this association,
//     derived from the operating-account GL ledger (date · description ·
//     amount), so the team can sanity-check method + GL against history.
//
// Staff-only.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  listVendorAccounts,
  listAssociationBankAccounts,
  listGlTransactionsByDate,
  checkDuplicateInvoice,
  listVendorsFull,
} from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// Normalize an invoice number so "1551" == "#1551" == "INV-1551".
const normInv = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Legal-suffix / filler noise we strip before token-matching a vendor name
// against a ledger description.
const NAME_NOISE = new Set(['llc', 'inc', 'corp', 'ltd', 'co', 'company', 'services', 'service', 'systems', 'system', 'group', 'the', 'of', 'and', 'pllc', 'pa', 'lp'])
/** Distinctive (≥4-char, non-noise) tokens from any of a vendor's names —
 *  legal name, DBA and check name — used to spot the vendor in a CINC
 *  ledger description. Many ledgers carry the DBA ("Envera") not the legal
 *  name ("Hidden Eyes LLC"), so we match against all three. */
function vendorNameTokens(...names: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const n of names) {
    for (const tok of norm(n ?? '').split(' ')) {
      if (tok.length >= 4 && !NAME_NOISE.has(tok)) out.add(tok)
    }
  }
  return out
}

interface DupHit { source: string; invoiceNumber: string | null; amount: number | null; date: string | null; status: string | null; paid: boolean; cincInvoiceId: string | null }

export async function GET(req: Request) {
  const t = (await cookies()).get(SESSION_COOKIE)?.value
  const s = t ? await verifySession(t) : null
  if (s?.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url        = new URL(req.url)
  const vendorId   = parseInt(url.searchParams.get('vendorId') ?? '', 10)
  const assoc      = (url.searchParams.get('assoc') ?? '').trim().toUpperCase()
  const vendorName = (url.searchParams.get('vendorName') ?? '').trim()
  const invoiceNo  = (url.searchParams.get('invoiceNumber') ?? '').trim()
  const amount     = parseFloat(url.searchParams.get('amount') ?? '')
  const draftId    = parseInt(url.searchParams.get('draftId') ?? '', 10)
  if (!Number.isFinite(vendorId) || !assoc) {
    return NextResponse.json({ error: 'vendorId and assoc required' }, { status: 400 })
  }

  // Pull the vendor's CINC record so we can match the ledger against the
  // legal name AND the DBA / check name (LCLUB ledgers carry "Envera", not
  // "Hidden Eyes LLC"). Best-effort — falls back to just the passed name.
  let vendorDba: string | null = null
  let vendorCheckName: string | null = null
  try {
    const all = await listVendorsFull()
    const v = all.find(x => x.VendorId === vendorId)
    if (v) { vendorDba = v.Dba ?? null; vendorCheckName = v.CheckName ?? null }
  } catch { /* fall back to vendorName only */ }
  const nameTokens = vendorNameTokens(vendorName, vendorDba, vendorCheckName)

  // GL suggestion — the vendor's account for THIS association. If CINC has
  // no vendor-account mapping (common), fall back to the GL we booked this
  // vendor to on the most recent invoice we processed through MAIA.
  let suggestedGl: { glAccount: string | null; accountNumber: string | null; source: string } | null = null
  try {
    const accounts = await listVendorAccounts(vendorId)
    const acct = accounts.find(a => a.assocCode === assoc)
    if (acct && acct.glAccount) suggestedGl = { glAccount: acct.glAccount, accountNumber: acct.accountNumber, source: 'CINC vendor account' }
  } catch { /* leave null */ }
  if (!suggestedGl) {
    try {
      const { data: priorGl } = await supabaseAdmin
        .from('invoice_intake_drafts')
        .select('gl_account_name, gl_account_id, created_at')
        .eq('matched_cinc_vendor_id', String(vendorId))
        .eq('extracted_association_code', assoc)
        .not('gl_account_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (priorGl?.gl_account_name) suggestedGl = { glAccount: String(priorGl.gl_account_name), accountNumber: priorGl.gl_account_id ? String(priorGl.gl_account_id) : null, source: 'last MAIA invoice' }
    } catch { /* leave null */ }
  }

  // Pull the operating cash ledger ONCE (6 months). Used for both the
  // "recent payments" panel (matched by vendor name tokens) and the
  // double-pay guard's same-amount scan (matched by amount, name-agnostic —
  // catches recurring vendors whose ledger lines carry no name).
  let ledgerTxns: Array<{ date: string | null; description: string; amount: number }> = []
  let ledgerScanned = 0
  try {
    const banks = await listAssociationBankAccounts(assoc)
    const operating = banks.find(b => b.kind === 'operating') ?? banks[0]
    if (operating?.cashGl) {
      const to = new Date()
      const from = new Date(); from.setMonth(from.getMonth() - 6)
      const txns = await listGlTransactionsByDate({
        assocCode:     assoc,
        fromDate:      from.toISOString().slice(0, 10),
        toDate:        to.toISOString().slice(0, 10),
        accountNumber: operating.cashGl,
      })
      ledgerTxns = txns
        .filter(x => (x.CreditAmount ?? 0) > 0)
        .map(x => ({ date: (x.TransactionDate ?? '').slice(0, 10) || null, description: x.Description ?? '', amount: x.CreditAmount ?? 0 }))
      ledgerScanned = ledgerTxns.length
    }
  } catch { /* leave empty */ }

  // Recent payments — ledger outflows whose description carries one of the
  // vendor's name tokens (legal / DBA / check name).
  const recentPayments = ledgerTxns
    .filter(x => { const d = norm(x.description); return [...nameTokens].some(t => d.includes(t)) })
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    .slice(0, 5)
    .map(x => ({ date: x.date, description: x.description || null, amount: x.amount }))

  // ── Double-pay guard ──────────────────────────────────────────────
  // EXACT = same vendor + same invoice# (CINC's dup endpoint + our pushed
  //   drafts, normalized so "1551" == "#1551"). These hard-block "ready".
  // SAME-AMOUNT = same $ recently in approval / paid (our pipeline, our
  //   pushed history, AND any same-amount payment on the 6-month ledger).
  //   Surfaced as a warning to verify it's not a double — recurring vendors
  //   will hit this legitimately, but better safe than sorry.
  const exact: DupHit[] = []
  const sameAmount: DupHit[] = []
  let cincDupChecked = false
  let ourHistoryCount = 0
  try {
    if (invoiceNo) {
      cincDupChecked = true
      const cincDups = await checkDuplicateInvoice({ associationCode: assoc, vendorId, invoiceNumber: invoiceNo })
      for (const d of cincDups) {
        const paid = d.CheckNo != null || /paid/i.test(d.InvoiceStatus ?? '')
        exact.push({
          source: 'CINC', invoiceNumber: d.InvoiceNumber ?? null, amount: d.TotalInvoiceAmount ?? null,
          date: (d.InvoiceDate ?? '').slice(0, 10) || null, status: d.InvoiceStatus ?? (paid ? 'Paid' : null),
          paid, cincInvoiceId: String(d.InvoiceID),
        })
      }
    }
    const { data: ours } = await supabaseAdmin
      .from('invoice_intake_drafts')
      .select('id, extracted_invoice_number, extracted_amount, status, cinc_invoice_id, pushed_at, created_at')
      .eq('matched_cinc_vendor_id', String(vendorId))
      .in('status', ['pushed_to_cinc', 'ready_to_push', 'pending_review', 'duplicate_in_cinc'])
      .order('created_at', { ascending: false })
      .limit(60)
    ourHistoryCount = (ours ?? []).filter(r => !(draftId && r.id === draftId)).length
    const niNew = normInv(invoiceNo)
    for (const r of (ours ?? [])) {
      if (draftId && r.id === draftId) continue
      const ri = normInv(String(r.extracted_invoice_number ?? ''))
      const ra = Number(r.extracted_amount ?? NaN)
      const paid = r.status === 'pushed_to_cinc'
      const hit: DupHit = {
        source: paid ? 'Already pushed to CINC' : 'In review queue',
        invoiceNumber: r.extracted_invoice_number as string | null,
        amount: Number.isFinite(ra) ? ra : null,
        date: (String(r.pushed_at ?? r.created_at ?? '')).slice(0, 10) || null,
        status: r.status as string, paid, cincInvoiceId: (r.cinc_invoice_id as string | null) ?? null,
      }
      if (niNew && ri && ri === niNew) exact.push(hit)
      else if (Number.isFinite(amount) && Number.isFinite(ra) && Math.abs(ra - amount) < 0.01) sameAmount.push(hit)
    }
    // Same-amount payments anywhere on the 6-month ledger (name-agnostic).
    if (Number.isFinite(amount) && amount > 0) {
      for (const p of ledgerTxns) {
        if (Math.abs(p.amount - amount) < 0.01) {
          sameAmount.push({ source: 'Paid (bank ledger)', invoiceNumber: null, amount: p.amount, date: p.date, status: 'Paid', paid: true, cincInvoiceId: null })
        }
      }
    }
  } catch { /* best-effort — never block the screen on a guard failure */ }

  const duplicate = {
    exact,
    sameAmount,
    anyPaid:          exact.some(h => h.paid) || sameAmount.some(h => h.paid),
    hasHardDuplicate: exact.length > 0,
    amountLabel:      Number.isFinite(amount) ? fmt(amount) : null,
  }

  // What the guard actually inspected — so the UI can say "checked X, Y, Z".
  const scanned = {
    cincDuplicates: cincDupChecked,
    ledgerPayments: ledgerScanned,
    ourHistory:     ourHistoryCount,
  }

  return NextResponse.json({ suggestedGl, recentPayments, duplicate, scanned })
}
