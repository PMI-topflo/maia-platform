// =====================================================================
// lib/manors-club-welcome-package.ts
//
// User direction, 2026-08-27/28: MAIA does not manage Manors Club Inc.
// (MANXI's master association) — so instead of submitting anything TO
// them, MAIA pre-fills the Club's own real forms with the approved
// applicant's information and hands them back, for the resident to print
// and present in person at the Manors Club Management Office.
//
// Source: the real "Manors Club Files.pdf" Greg Rullo (Grant Property
// Management, the Club's management company) provided — pages 2-4 are the
// Recreational I.D. Pass Registration Form (== the Proximity Card
// application, the Club's own name for it), page 5 is the Application for
// Use of Elevator/Gate Pass. Both are FLAT forms (confirmed: zero AcroForm
// fields), so filling means overlaying text at the exact coordinates of
// each blank on the ORIGINAL embedded pages — never retyped/reconstructed,
// so the Club's own legal text (indemnity, rules, fees) is byte-identical
// to what they issued. Coordinates measured directly off the source PDF's
// text layer (pdfjs getTextContent), not eyeballed.
//
// Left BLANK deliberately (never fabricated): signatures, dates-signed,
// ID#, DOB, and anything move/visit-specific (elevator date/time/purpose)
// — MAIA doesn't have these and a resident must complete them by hand.
// =====================================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const INK = rgb(0.05, 0.05, 0.15)

export interface WelcomePackageInput {
  /** The source "Manors Club Files.pdf" bytes, unmodified. */
  sourcePdf: Buffer | Uint8Array
  ownerName: string
  /** Street address for "..., Lauderhill, Florida 33319" — e.g. "4174 Inverrary Drive, Unit 706". */
  unitAddress: string
  unitLabel: string
  /** 'tenant' checks "I rent this unit..." (Part A waiver) and lists tenant
   *  names in Part B; 'owner_occupant' checks "I own this unit..." and
   *  lists the owner as the resident in Part B instead. */
  scenario: 'tenant' | 'owner_occupant'
  /** Names of the people who will actually live there — tenants for a
   *  lease, or the owner/buyer themselves for an owner-occupant unit.
   *  Up to 3 print on the form (its own limit); the rest are omitted. */
  residentNames: string[]
  leaseStart?: string | null   // ISO date, tenant scenario only
  leaseEnd?: string | null     // ISO date, tenant scenario only
  applicantName: string
  applicantPhone: string | null
  applicantEmail: string | null
}

export interface WelcomePackageResult {
  /** Original pages 2-4 (Proximity Card / Recreational I.D. Pass Registration Form), pre-filled. */
  proximityCardForm: Uint8Array
  /** Original page 5 (Elevator/Gate Pass application), pre-filled. */
  elevatorGatePassForm: Uint8Array
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Draws `s` truncated (with an ellipsis) so it never overruns `maxWidth`
 *  at the given font/size — every blank on this form has a fixed length,
 *  and a long legal name must not spill into the next label. */
function drawFit(page: import('pdf-lib').PDFPage, s: string, x: number, y: number, maxWidth: number, font: import('pdf-lib').PDFFont, size = 10) {
  let text = s
  while (text.length > 1 && font.widthOfTextAtSize(text, size) > maxWidth) text = text.slice(0, -1)
  if (text !== s && text.length > 1) text = text.slice(0, -1) + '…'
  page.drawText(text, { x, y, size, font, color: INK })
}

export async function buildManorsClubWelcomePackage(input: WelcomePackageInput): Promise<WelcomePackageResult> {
  const src = await PDFDocument.load(input.sourcePdf)

  // ── Proximity Card / Recreational I.D. Pass Registration Form ──────
  // Source pages 2-4 (0-indexed 1-3): registration + rules + indemnity.
  const prox = await PDFDocument.create()
  const proxFont = await prox.embedFont(StandardFonts.Helvetica)
  const proxPages = await prox.copyPages(src, [1, 2, 3])
  proxPages.forEach(p => prox.addPage(p))
  const p1 = prox.getPage(0)

  // "PRINT OWNER NAME(S):" ends x=186.4, y=717.
  drawFit(p1, input.ownerName, 190, 717, 340, proxFont)

  // Checkbox blanks: "I own this unit..." at y=625 (blank x=72.2-108.5);
  // "I rent this unit..." at y=602 (blank x=72.2-108.5, same column).
  const checkY = input.scenario === 'owner_occupant' ? 625 : 602
  p1.drawText('X', { x: 82, y: checkY, size: 11, font: proxFont, color: INK })

  // Part A (Waiver) — only meaningful for a tenant scenario; an
  // owner-occupant doesn't waive anything, so Part A is left untouched.
  if (input.scenario === 'tenant') {
    // "I, (We) owner(s) of ___, Lauderhill, Florida" blank: x=150.5-433.0, y=510.
    drawFit(p1, input.unitAddress, 154, 510, 275, proxFont)
    // "Term of Lease from: ___ to: ___" — from blank x=158-250, to blank x=269-535, y=463.9.
    drawFit(p1, fmtDate(input.leaseStart), 160, 464, 88, proxFont, 9)
    drawFit(p1, fmtDate(input.leaseEnd), 270, 464, 260, proxFont, 9)
  }

  // Part B (Non-Waiver) — "I, (We) owner(s) of ___" blank, y=349,
  // same x range as Part A's. Filled either way: an owner-occupant
  // completes Part B directly; a tenant's owner also fills it "on behalf
  // of tenant" per the form's own instruction (page 2, Part A note).
  drawFit(p1, input.unitAddress, 154, 349, 275, proxFont)

  // Household list, "(Please print all names clearly)" — 3 rows, y=245.6/222.5/199.4(est).
  // Name blank per row: x=80-250 (before "ID#" at x=252.1).
  const rowYs = [245.6, 222.5, 199.4]
  input.residentNames.slice(0, 3).forEach((name, i) => drawFit(p1, name, 82, rowYs[i], 165, proxFont))

  const proximityCardForm = await prox.save()

  // ── Application for Use of Elevator/Gate Pass ───────────────────────
  // Source page 5 (0-indexed 4).
  const elev = await PDFDocument.create()
  const elevFont = await elev.embedFont(StandardFonts.Helvetica)
  const [elevPage] = await elev.copyPages(src, [4])
  elev.addPage(elevPage)
  const p5 = elev.getPage(0)

  // "NAME:____" blank x=106.5-348.6, y=592.1. "UNIT:____" blank x=380.4-511.6.
  drawFit(p5, input.applicantName, 110, 592, 235, elevFont)
  drawFit(p5, input.unitLabel, 384, 592, 125, elevFont)
  // "PHONE:____" blank x=111.9-282.2, y=565.3. "EMAIL:____" blank x=329.1-510.8.
  if (input.applicantPhone) drawFit(p5, input.applicantPhone, 116, 565, 165, elevFont)
  if (input.applicantEmail) drawFit(p5, input.applicantEmail, 333, 565, 175, elevFont)

  const elevatorGatePassForm = await elev.save()

  return { proximityCardForm, elevatorGatePassForm }
}
