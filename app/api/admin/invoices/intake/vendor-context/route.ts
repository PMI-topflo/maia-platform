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
  getAssociationBudget,
  getCincInvoice,
  lookupPriorInvoiceMethod,
  type CincGlTransaction,
} from '@/lib/integrations/cinc'
import { lookupVendorMethod } from '@/lib/account-routing'

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
  const accountNo  = (url.searchParams.get('accountNumber') ?? '').trim()
  const invoiceDt  = (url.searchParams.get('invoiceDate') ?? '').trim()
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

  // Pull the GL ledger across ALL accounts ONCE (6 months). Powers three
  // things: the "recent payments" panel + double-pay same-amount scan
  // (operating cash credits), AND detecting the expense GL this vendor's
  // invoices were booked to — the expense-side debit lives on a different
  // account than the cash credit, so we need every account, not just cash.
  let allTxns: CincGlTransaction[] = []
  let ledgerTxns: Array<{ date: string | null; description: string; amount: number }> = []
  let ledgerScanned = 0
  let operatingCashGl: string | null = null
  try {
    const banks = await listAssociationBankAccounts(assoc)
    // Prefer the account literally described "operating" (the true checking
    // account) over anything merely classified operating by GL prefix — some
    // assocs have a debt-service account on a 10- cash GL that would shadow it.
    const operating =
      banks.find(b => /operating/i.test(b.description)) ??
      banks.find(b => b.kind === 'operating') ??
      banks[0]
    operatingCashGl = operating?.cashGl ?? null
    const to = new Date()
    const from = new Date(); from.setMonth(from.getMonth() - 6)
    allTxns = await listGlTransactionsByDate({ assocCode: assoc, fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) })
    if (operatingCashGl) {
      ledgerTxns = allTxns
        .filter(x => x.AccountNumber === operatingCashGl && (x.CreditAmount ?? 0) > 0)
        .map(x => ({ date: (x.TransactionDate ?? '').slice(0, 10) || null, description: x.Description ?? '', amount: x.CreditAmount ?? 0 }))
      ledgerScanned = ledgerTxns.length
    }
  } catch { /* leave empty */ }

  // Recent payments — ledger outflows whose description carries one of the
  // vendor's name tokens (legal / DBA / check name). CINC ledger lines often
  // omit the vendor name entirely (they read "Inv.#… - <service>"), so when
  // the name match is empty we fall back to payments of the SAME amount as
  // this invoice — for a recurring vendor (e.g. monthly monitoring) that
  // surfaces the prior payments the reviewer actually wants to see.
  const byName = ledgerTxns.filter(x => { const d = norm(x.description); return [...nameTokens].some(t => d.includes(t)) })
  const byAmount = (Number.isFinite(amount) && amount > 0)
    ? ledgerTxns.filter(x => Math.abs(x.amount - amount) < 0.01)
    : []
  const seen = new Set<string>()
  const recentPayments = [...byName, ...byAmount]
    .filter(x => { const k = `${x.date}|${x.amount}|${x.description}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    .slice(0, 6)
    .map(x => ({ date: x.date, description: x.description || null, amount: x.amount, matchedByName: byName.includes(x) }))

  // GL suggestion, in priority order:
  //   1. CINC's vendor-account GL mapping for this assoc (often empty).
  //   2. The expense GL this vendor's recent invoices were actually booked
  //      to — found by taking the invoice numbers off the recent payments
  //      and looking up their expense-side debit (a non-cash account) in the
  //      ledger, then naming it via the association budget.
  //   3. The GL we used on the last MAIA invoice for this vendor.
  let suggestedGl: { glAccount: string | null; accountNumber: string | null; source: string } | null = null
  // The account number CINC has on file for THIS vendor at THIS association —
  // the forward direction: pick the association → bring the right account #.
  let suggestedAccountNumber: string | null = null
  try {
    const accounts = await listVendorAccounts(vendorId)
    const acct = accounts.find(a => a.assocCode === assoc)
    if (acct && acct.glAccount) suggestedGl = { glAccount: acct.glAccount, accountNumber: acct.accountNumber, source: 'CINC vendor account' }
    if (acct && acct.accountNumber) suggestedAccountNumber = acct.accountNumber
  } catch { /* leave null */ }

  if (!suggestedGl && recentPayments.length > 0 && allTxns.length > 0) {
    try {
      const invNums = new Set<string>()
      for (const p of recentPayments) {
        const m = /inv\.?\s*#?\s*([a-z0-9][a-z0-9-]*)/i.exec(p.description ?? '')
        if (m) invNums.add(m[1].toLowerCase())
      }
      if (invNums.size > 0) {
        // Tally the expense GL each matching invoice was booked to (the
        // non-cash account carrying the debit), then take the most common.
        const tally = new Map<string, number>()
        for (const tx of allTxns) {
          const acct = String(tx.AccountNumber ?? '')
          if (!acct || acct === operatingCashGl) continue
          if ((tx.DebitAmount ?? 0) === 0) continue
          const d = (tx.Description ?? '').toLowerCase()
          if ([...invNums].some(n => d.includes(n))) tally.set(acct, (tally.get(acct) ?? 0) + 1)
        }
        let bestAcct: string | null = null, bestCount = 0
        for (const [a, c] of tally) if (c > bestCount) { bestAcct = a; bestCount = c }
        if (bestAcct) {
          let label = bestAcct
          try {
            const budget = await getAssociationBudget(assoc)
            const line = budget.find(l => l.number === bestAcct)
            if (line) label = `${line.number} ${line.name}`
          } catch { /* name stays as the raw GL number */ }
          suggestedGl = { glAccount: label, accountNumber: bestAcct, source: `${bestCount} past invoice${bestCount === 1 ? '' : 's'}` }
        }
      }
    } catch { /* leave null */ }
  }

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

  // Suggested PAY-FROM bank — the account this vendor's last MAIA invoice at
  // this association was actually paid from. Critical when that was NOT the
  // operating account (a reserve/project invoice), so the next one defaults to
  // the same source instead of snapping back to operating.
  let suggestedBank: { id: number; source: string } | null = null
  try {
    const { data: priorBank } = await supabaseAdmin
      .from('invoice_intake_drafts')
      .select('pay_from_bank_account_id, created_at')
      .eq('matched_cinc_vendor_id', String(vendorId))
      .eq('extracted_association_code', assoc)
      .not('pay_from_bank_account_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (priorBank?.pay_from_bank_account_id != null) {
      suggestedBank = { id: Number(priorBank.pay_from_bank_account_id), source: 'last MAIA invoice' }
    }
  } catch { /* leave null */ }

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

  // Suggested payment method — read the vendor's MOST RECENT pushed invoice's
  // PayByType from CINC (the invoice GET returns the method CINC applied). This
  // brings the vendor's actual method WITHOUT pushing anything new, and works
  // even though CINC's vendor record doesn't expose its Default Pmt Method.
  let suggestedPayBy: { method: string; source: string } | null = null
  // Primary: the vendor's learned method from the 12-month backfill (covers
  // every vendor, from real CINC payment history).
  try {
    const vm = await lookupVendorMethod(vendorId)
    if (vm) suggestedPayBy = { method: vm.method, source: `${vm.sampleCount} paid invoice${vm.sampleCount === 1 ? '' : 's'} (12-mo history)` }
  } catch { /* best-effort */ }
  if (!suggestedPayBy) try {
    const { data: lastPushed } = await supabaseAdmin
      .from('invoice_intake_drafts')
      .select('cinc_invoice_id, extracted_invoice_number')
      .eq('matched_cinc_vendor_id', String(vendorId))
      .eq('status', 'pushed_to_cinc')
      .not('cinc_invoice_id', 'is', null)
      .order('pushed_at', { ascending: false })
      .limit(3)
    for (const row of lastPushed ?? []) {
      const inv = await getCincInvoice(parseInt(String(row.cinc_invoice_id), 10)).catch(() => null)
      const pbt = (inv?.PayByType ?? '').trim()
      if (pbt) { suggestedPayBy = { method: pbt, source: `last invoice #${row.extracted_invoice_number ?? row.cinc_invoice_id}` }; break }
    }
  } catch { /* best-effort — never block the screen */ }

  // Fallback for vendors we've never pushed via MAIA (e.g. Xfinity): if the
  // invoice number embeds the billing period, derive the PRIOR month's number
  // and read the actual Pay By off CINC's paid invoice. No push needed.
  if (!suggestedPayBy && (accountNo || invoiceNo)) {
    try {
      const prior = await lookupPriorInvoiceMethod({
        invoiceNumber: invoiceNo || null,
        accountNumber: accountNo || null,
        aroundDate:    invoiceDt || null,
        vendorId,
      })
      if (prior) suggestedPayBy = { method: prior.payByType, source: `CINC invoice #${prior.invoiceNumber}` }
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ suggestedGl, suggestedAccountNumber, suggestedPayBy, suggestedBank, recentPayments, duplicate, scanned })
}
