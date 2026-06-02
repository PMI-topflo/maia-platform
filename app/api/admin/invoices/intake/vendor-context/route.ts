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
} from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// Normalize an invoice number so "1551" == "#1551" == "INV-1551".
const normInv = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

  // GL suggestion — the vendor's account for THIS association.
  let suggestedGl: { glAccount: string | null; accountNumber: string | null } | null = null
  try {
    const accounts = await listVendorAccounts(vendorId)
    const acct = accounts.find(a => a.assocCode === assoc)
    if (acct && acct.glAccount) suggestedGl = { glAccount: acct.glAccount, accountNumber: acct.accountNumber }
  } catch { /* leave null */ }

  // Recent payments — outflows to this vendor on the operating cash ledger.
  let recentPayments: Array<{ date: string | null; description: string | null; amount: number }> = []
  try {
    if (vendorName) {
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
        const vn2 = norm(vendorName).split(' ').slice(0, 2).join(' ')
        recentPayments = txns
          .filter(x => (x.CreditAmount ?? 0) > 0 && vn2 && norm(x.Description ?? '').includes(vn2))
          .sort((a, b) => String(b.TransactionDate ?? '').localeCompare(String(a.TransactionDate ?? '')))
          .slice(0, 5)
          .map(x => ({ date: (x.TransactionDate ?? '').slice(0, 10) || null, description: x.Description ?? null, amount: x.CreditAmount ?? 0 }))
      }
    }
  } catch { /* leave empty */ }

  // ── Double-pay guard ──────────────────────────────────────────────
  // EXACT = same vendor + same invoice# (CINC's dup endpoint + our pushed
  //   drafts, normalized so "1551" == "#1551"). These hard-block "ready".
  // SAME-AMOUNT = same vendor + same $ recently in approval or paid (incl.
  //   our pipeline, our pushed history, and the paid ledger). Surfaced as a
  //   warning to verify it's not a double — recurring vendors will hit this
  //   legitimately, but better safe than sorry.
  const exact: DupHit[] = []
  const sameAmount: DupHit[] = []
  try {
    if (invoiceNo) {
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
    if (Number.isFinite(amount)) {
      for (const p of recentPayments) {
        if (Math.abs((p.amount ?? 0) - amount) < 0.01) {
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

  return NextResponse.json({ suggestedGl, recentPayments, duplicate })
}
