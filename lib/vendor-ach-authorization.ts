// =====================================================================
// lib/vendor-ach-authorization.ts
// Build the signed vendor ACH / direct-deposit authorization PDF from what
// the vendor entered in the self-service form. The routing + account numbers
// are rendered as clear, labeled text so the existing "→ CINC" staff push
// (which re-reads the file server-side) can apply them to the CINC vendor
// record. This generated PDF is the only place the full account number is
// stored — the database keeps last-4 only.
// =====================================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface AchAuthorizationInput {
  vendorName:      string
  woLabel:         string
  bankName:        string | null
  routing:         string
  account:         string
  accountType:     'checking' | 'savings'
  authorizedName:  string
  authorizedTitle: string
  /** ISO date string (YYYY-MM-DD) the vendor authorized. */
  date:            string
  /** Free context appended to the audit footer (e.g. "submitted electronically"). */
  submissionNote?: string
}

export const ACH_CERTIFICATION =
  'I certify that I am authorized to provide these banking details on behalf of the vendor named above, ' +
  'that the information is accurate and current, and that I accept full responsibility for it. ' +
  'I authorize PMI Top Florida Properties to set up ACH / direct-deposit payments to this account, ' +
  'and to rely on this information until I notify PMI in writing of a change.'

export async function buildAchAuthorizationPdf(input: AchAuthorizationInput): Promise<Buffer> {
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
  // Word-wrap a paragraph at ~92 chars.
  const paragraph = (text: string, size = 9, color = gray) => {
    const max = 92
    const words = text.split(/\s+/)
    let lineStr = ''
    for (const w of words) {
      if ((lineStr + ' ' + w).trim().length > max) { draw(lineStr, { size, color }); y -= size + 3; lineStr = w }
      else lineStr = (lineStr + ' ' + w).trim()
    }
    if (lineStr) { draw(lineStr, { size, color }); y -= size + 3 }
  }

  draw('PMI Top Florida Properties', { font: bold, size: 13, color: rgb(0.95, 0.42, 0.11) }); y -= 30
  draw('VENDOR ACH / DIRECT DEPOSIT AUTHORIZATION', { font: bold, size: 16 }); y -= 28
  draw(input.vendorName, { font: bold, size: 13 }); y -= 16
  draw(input.woLabel, { color: gray, size: 10 }); y -= 30

  field('Bank name', input.bankName ?? '—')
  field('Routing number', input.routing)
  field('Account number', input.account)
  field('Account type', input.accountType === 'savings' ? 'Savings' : 'Checking')
  y -= 8

  draw('Authorization', { font: bold, size: 11 }); y -= 18
  paragraph(ACH_CERTIFICATION)
  y -= 18

  // Signature block.
  page.drawLine({ start: { x: 56, y: y + 14 }, end: { x: 320, y: y + 14 }, thickness: 0.7, color: gray })
  page.drawText(`${input.authorizedName}${input.authorizedTitle ? ` — ${input.authorizedTitle}` : ''}`,
    { x: 56, y: y + 2, size: 11, font: bold, color: navy })
  page.drawText(`Date: ${input.date}`, { x: 360, y: y + 2, size: 10, font: helv, color: gray })
  y -= 40

  page.drawText(
    `Authorized electronically through the PMI vendor portal on ${input.date}.${input.submissionNote ? ` ${input.submissionNote}` : ''}`,
    { x: 56, y: Math.max(y, 40), size: 8, font: helv, color: gray },
  )

  return Buffer.from(await doc.save())
}
