// =====================================================================
// lib/owner-ledger.ts
// Helpers for the owner "send me my ledger" self-service flow:
//   • ledgerDateRange  — the statement window (YTD, or last 3 months in Jan)
//   • normalizeLedger  — CINC rows → clean lines, filtered to the window
//   • renderLedgerPdf  — a branded PDF statement (pdf-lib)
// =====================================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { CincHomeownerTransaction } from '@/lib/integrations/cinc'

/** The date window for a ledger request: the entire current year so far, or —
 *  in January, when YTD is nearly empty — the last 3 months instead. Returns
 *  ISO 'YYYY-MM-DD' bounds + a human label. Stays within CINC's 366-day cap. */
export function ledgerDateRange(today: Date = new Date()): { fromDate: string; toDate: string; label: string } {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() // 0 = January
  const toDate = today.toISOString().slice(0, 10)

  if (m === 0) {
    // January → last 3 months (Nov 1 of the prior year through today).
    const from = new Date(Date.UTC(y, m - 2, 1)) // m-2 = -2 → November of y-1
    return { fromDate: from.toISOString().slice(0, 10), toDate, label: 'the last 3 months' }
  }
  return { fromDate: `${y}-01-01`, toDate, label: `${y} (year to date)` }
}

export interface LedgerLine {
  date:        string   // 'YYYY-MM-DD'
  description: string
  charge:      number   // Debit
  payment:     number   // Credit
  balance:     number   // RunningBalance after the line
}

/** Map CINC rows → clean lines and keep only those inside [fromDate, toDate]
 *  (CINC ignores the date params and returns the whole schedule, including
 *  future-dated assessments, so we filter here). Sorted oldest → newest. */
export function normalizeLedger(rows: CincHomeownerTransaction[], fromDate: string, toDate: string): LedgerLine[] {
  return (rows ?? [])
    .map(r => ({
      date:        String(r.Date ?? '').slice(0, 10),
      description: String(r.Assessment || r.Description || r.TransactionTypeDescription || '').trim() || '—',
      charge:      Number(r.Debit ?? 0)  || 0,
      payment:     Number(r.Credit ?? 0) || 0,
      balance:     Number(r.RunningBalance ?? 0) || 0,
    }))
    .filter(l => l.date && l.date >= fromDate && l.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const money = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`)
const ORANGE = rgb(0.949, 0.416, 0.106)
const INK    = rgb(0.07, 0.07, 0.07)
const GREY   = rgb(0.42, 0.45, 0.5)

export interface LedgerMeta {
  ownerName:   string
  unit:        string | null
  address:     string | null
  association: string
  periodLabel: string
  generatedOn: string   // 'YYYY-MM-DD'
}

/** Render a branded one-or-more-page PDF account statement. Returns PDF bytes. */
export async function renderLedgerPdf(meta: LedgerMeta, lines: LedgerLine[]): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const W = 612, H = 792, M = 48
  const colX = { date: M, desc: M + 78, charge: 360, payment: 432, balance: 510 }
  const rowH = 18

  let page = doc.addPage([W, H])
  let y = H - M

  const text = (s: string, x: number, yy: number, size = 9, f = font, color = INK) =>
    page.drawText(s, { x, y: yy, size, font: f, color })
  // Right-align money at a column's right edge.
  const textR = (s: string, xRight: number, yy: number, size = 9, f = font, color = INK) =>
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color })

  function drawColHeads() {
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.96, 0.96, 0.97) })
    text('Date', colX.date, y, 8.5, bold, GREY)
    text('Description', colX.desc, y, 8.5, bold, GREY)
    textR('Charge', colX.charge + 52, y, 8.5, bold, GREY)
    textR('Payment', colX.payment + 60, y, 8.5, bold, GREY)
    textR('Balance', colX.balance + 54, y, 8.5, bold, GREY)
    y -= rowH + 2
  }

  // Header
  text('PMI Top Florida Properties', M, y, 15, bold, ORANGE); y -= 18
  text('Account Statement', M, y, 11, bold, INK); y -= 22
  text(`${meta.ownerName}${meta.unit ? ` · Unit ${meta.unit}` : ''}`, M, y, 10, bold); y -= 14
  if (meta.address) { text(meta.address, M, y, 9, font, GREY); y -= 13 }
  text(`${meta.association} · Period: ${meta.periodLabel}`, M, y, 9, font, GREY); y -= 20
  drawColHeads()

  for (const l of lines) {
    if (y < M + 60) { page = doc.addPage([W, H]); y = H - M; drawColHeads() }
    text(l.date, colX.date, y, 9)
    const desc = l.description.length > 46 ? l.description.slice(0, 45) + '…' : l.description
    text(desc, colX.desc, y, 9)
    if (l.charge)  textR(money(l.charge),  colX.charge + 52, y, 9)
    if (l.payment) textR(money(l.payment), colX.payment + 60, y, 9, font, rgb(0.1, 0.5, 0.2))
    textR(money(l.balance), colX.balance + 54, y, 9, bold)
    y -= rowH
  }

  // Totals + footer
  const totCharge  = lines.reduce((s, l) => s + l.charge, 0)
  const totPayment = lines.reduce((s, l) => s + l.payment, 0)
  const endBalance = lines.length ? lines[lines.length - 1].balance : 0
  if (y < M + 60) { page = doc.addPage([W, H]); y = H - M }
  y -= 6
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.75, color: GREY })
  text('Totals', colX.desc, y - 6, 9, bold)
  textR(money(totCharge),  colX.charge + 52, y - 6, 9, bold)
  textR(money(totPayment), colX.payment + 60, y - 6, 9, bold)
  textR(money(endBalance), colX.balance + 54, y - 6, 9, bold, endBalance > 0 ? rgb(0.7, 0.1, 0.1) : INK)
  y -= 30
  text(`Current balance: ${money(endBalance)}`, M, y, 11, bold, endBalance > 0 ? rgb(0.7, 0.1, 0.1) : INK); y -= 22
  text(`Generated ${meta.generatedOn} · Questions? ar@topfloridaproperties.com · (305) 900-5077`, M, y, 8, font, GREY)
  text('Pay online: https://pmitfp.cincwebaxis.com/', M, y - 12, 8, font, GREY)

  return await doc.save()
}
