// =====================================================================
// lib/vendor-w9-record.ts
// Build a Substitute Form W-9 PDF from what the vendor entered in the
// self-service tax form. The TIN (EIN/SSN) is rendered as clear, labeled
// text so the existing "→ CINC" staff push (which re-reads the file) can
// apply TaxID + CheckName to the CINC vendor record. This generated PDF is
// the only place the full TIN is stored — the database keeps last-4 only.
// A substitute W-9 is an accepted alternative to the IRS form as long as it
// carries the exact IRS certification language (included below).
// =====================================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export type TaxClassification =
  | 'individual' | 'c_corp' | 's_corp' | 'partnership' | 'trust_estate' | 'llc' | 'other'

export const TAX_CLASSIFICATION_LABELS: Record<TaxClassification, string> = {
  individual:   'Individual / sole proprietor',
  c_corp:       'C corporation',
  s_corp:       'S corporation',
  partnership:  'Partnership',
  trust_estate: 'Trust / estate',
  llc:          'Limited liability company (LLC)',
  other:        'Other',
}

export interface W9RecordInput {
  vendorName:      string
  woLabel:         string
  legalName:       string
  businessName?:   string | null
  classification:  TaxClassification
  tinType:         'ein' | 'ssn'
  tin:             string            // 9 digits
  authorizedName:  string
  authorizedTitle: string
  date:            string            // YYYY-MM-DD
}

// The IRS-required Form W-9 certification (Part II), verbatim in substance.
export const W9_CERTIFICATION_LINES = [
  'Under penalties of perjury, I certify that:',
  '1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
  '2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the IRS that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
  '3. I am a U.S. citizen or other U.S. person; and',
  '4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
]

function fmtTin(tinType: 'ein' | 'ssn', tin: string): string {
  const d = tin.replace(/\D/g, '')
  if (d.length !== 9) return d
  return tinType === 'ein' ? `${d.slice(0, 2)}-${d.slice(2)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

export async function buildW9RecordPdf(input: W9RecordInput): Promise<Buffer> {
  const doc  = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const navy = rgb(0.08, 0.13, 0.27)
  const gray = rgb(0.42, 0.45, 0.5)
  let y = 740

  const draw = (text: string, opts: { font?: typeof helv; size?: number; color?: typeof navy; x?: number } = {}) => {
    page.drawText(text, { x: opts.x ?? 56, y, size: opts.size ?? 11, font: opts.font ?? helv, color: opts.color ?? navy })
  }
  const field = (label: string, value: string) => {
    draw(label.toUpperCase(), { font: bold, size: 9, color: gray }); y -= 14
    draw(value || '—', { size: 12 }); y -= 24
  }
  const paragraph = (text: string, size = 8.5, color = gray) => {
    const max = 100
    const words = text.split(/\s+/)
    let lineStr = ''
    for (const w of words) {
      if ((lineStr + ' ' + w).trim().length > max) { draw(lineStr, { size, color }); y -= size + 3; lineStr = w }
      else lineStr = (lineStr + ' ' + w).trim()
    }
    if (lineStr) { draw(lineStr, { size, color }); y -= size + 3 }
  }

  draw('PMI Top Florida Properties', { font: bold, size: 13, color: rgb(0.95, 0.42, 0.11) }); y -= 30
  draw('SUBSTITUTE FORM W-9 — REQUEST FOR TAXPAYER ID', { font: bold, size: 14 }); y -= 26
  draw(input.vendorName, { font: bold, size: 13 }); y -= 16
  draw(input.woLabel, { color: gray, size: 10 }); y -= 28

  field('Name (as shown on your income tax return)', input.legalName)
  if (input.businessName) field('Business name / disregarded entity name', input.businessName)
  field('Federal tax classification', TAX_CLASSIFICATION_LABELS[input.classification])
  field(input.tinType === 'ein' ? 'Employer Identification Number (EIN)' : 'Social Security Number (SSN)', fmtTin(input.tinType, input.tin))
  y -= 6

  draw('Certification', { font: bold, size: 11 }); y -= 16
  for (const lineStr of W9_CERTIFICATION_LINES) { paragraph(lineStr); y -= 2 }
  y -= 14

  page.drawLine({ start: { x: 56, y: y + 14 }, end: { x: 320, y: y + 14 }, thickness: 0.7, color: gray })
  page.drawText(`${input.authorizedName}${input.authorizedTitle ? ` — ${input.authorizedTitle}` : ''}`,
    { x: 56, y: y + 2, size: 11, font: bold, color: navy })
  page.drawText(`Date: ${input.date}`, { x: 360, y: y + 2, size: 10, font: helv, color: gray })
  y -= 36

  page.drawText(`Signed electronically through the PMI vendor portal on ${input.date}.`,
    { x: 56, y: Math.max(y, 40), size: 8, font: helv, color: gray })

  return Buffer.from(await doc.save())
}
