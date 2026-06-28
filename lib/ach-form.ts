// =====================================================================
// lib/ach-form.ts
// MAIA-generated "Direct Debit Form (ACH)" — a faithful copy of PMI's
// homeowner ACH authorization form, with the owner's identity pre-filled.
// Served in-app (secure link) instead of a Google Drive folder. The owner
// completes the bank fields + signs and emails it (with a voided check) to
// ar@topfloridaproperties.com.
// =====================================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const ORANGE = rgb(0.949, 0.416, 0.106)
const INK    = rgb(0.1, 0.1, 0.1)
const GREY   = rgb(0.42, 0.45, 0.5)
const BLUE   = rgb(0.12, 0.33, 0.6)

export interface AchFormMeta {
  ownerName:   string
  unit:        string | null
  address:     string | null
  association: string
  account:     string
  generatedOn: string
  // Contact info on file (pre-filled on both the printable + signed copy).
  email?:          string | null
  phone?:          string | null
  mailingAddress?: string | null
  city?:           string | null
  state?:          string | null
  zip?:            string | null
  // Optional — present only on the SIGNED copy (owner completed it online).
  bankName?:         string
  accountOwnerName?: string
  accountType?:      'checking' | 'savings'
  routing?:          string
  accountNumber?:    string
  signatureName?:    string
  signatureImage?:   string   // PNG data URL of the drawn signature
  signedOn?:         string
}

export async function renderAchAuthorizationPdf(meta: AchFormMeta): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 612, H = 792, M = 48
  const page = doc.addPage([W, H])
  let y = H - 44
  const chk = (on: boolean) => (on ? '[x]' : '[ ]')

  const draw = (s: string, x: number, size = 9.5, f = font, color = INK) => page.drawText(s, { x, y, size, font: f, color })
  const center = (s: string, size: number, f = font, color = INK) => page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y, size, font: f, color })
  // A labelled fill-in line; `value` pre-fills it, otherwise it's blank.
  const field = (label: string, x: number, width: number, value = '', size = 9) => {
    page.drawText(label, { x, y, size, font, color: INK })
    const lx = x + font.widthOfTextAtSize(label, size) + 4
    page.drawLine({ start: { x: lx, y: y - 2 }, end: { x: x + width, y: y - 2 }, thickness: 0.6, color: GREY })
    if (value) page.drawText(value, { x: lx + 2, y: y + 1, size, font: bold, color: INK })
  }
  const box = (yTop: number, yBot: number) => page.drawRectangle({ x: M, y: yBot, width: W - 2 * M, height: yTop - yBot, borderColor: GREY, borderWidth: 0.8 })

  // Header
  draw('pmi', M, 22, bold, ORANGE); draw('Top Florida Properties', M + 42, 11, bold, ORANGE)
  y -= 26; center('Direct Debit Form (ACH)', 16, bold, INK)
  y -= 20; draw('Sign up to automatically pay your Condo/HOA payment from your checking or savings account at any U.S. financial institution.', M, 8.5, font, INK)
  y -= 13; draw('To enroll, send an e-mail with this authorization form and an attached voided check to ar@topfloridaproperties.com.', M, 8.5, bold, INK)

  // Homeowner Information
  y -= 24; draw('Homeowner Information:', M + 6, 11, bold, BLUE)
  const hTop = y + 16
  y -= 20; field('Property Name:', M + 8, 500, meta.association)
  y -= 20; field('Property Address:', M + 8, 500, meta.address ?? '')
  y -= 20; field('Unit Number:', M + 8, 260, meta.unit ?? '')
  y -= 20; field('Property Owner Name(s):', M + 8, 500, meta.ownerName)
  y -= 20; field('Bank Account Owner Name(s):', M + 8, 500, meta.accountOwnerName ?? '')
  y -= 20; field('Email Address:', M + 8, 500, meta.email ?? '')
  y -= 20; field('Phone Number:', M + 8, 260, meta.phone ?? '')
  y -= 20; field('Mailing Address:', M + 8, 500, meta.mailingAddress ?? '')
  y -= 20; field('City:', M + 8, 200, meta.city ?? ''); field('State:', M + 240, 320, meta.state ?? ''); field('Zip:', M + 380, 500, meta.zip ?? '')
  y -= 14; box(hTop, y + 4)

  // Banking Information
  y -= 26; draw('Banking Information:', M + 6, 11, bold, BLUE)
  draw('[ ] New    [ ] Change    [ ] Cancel', M + 180, 9.5, bold, INK)
  const bTop = y + 16
  y -= 22; field('Name of Financial Institution:', M + 8, 320, meta.bankName ?? '')
  draw(`Account Type:  ${chk(meta.accountType === 'checking')} Checking   ${chk(meta.accountType === 'savings')} Savings`, M + 330, 9, font, INK)
  y -= 24; field('Bank Routing Number:', M + 8, 250, meta.routing ?? ''); field('Bank Account Number:', M + 270, 510, meta.accountNumber ?? '')
  y -= 22; draw('I authorize PMI Top Florida Properties to initiate entries from my checking/savings account the full amount of all', M + 8, 8.5, font, INK)
  y -= 12; draw('charges uploaded in the account. This authority will remain in effect until I notify you in writing to cancel it in', M + 8, 8.5, font, INK)
  y -= 12; draw('such time as to afford the company a reasonable opportunity to act on it.', M + 8, 8.5, font, INK)
  y -= 28; field('Authorized Signature(s):', M + 8, 380, meta.signatureImage ? '' : (meta.signatureName ?? '')); field('Date:', M + 400, 510, meta.signedOn ?? '')
  if (meta.signatureImage) {
    try {
      const png = await doc.embedPng(meta.signatureImage)
      const w = 140, h = Math.min((png.height / png.width) * w, 28)
      page.drawImage(png, { x: M + 120, y: y - 4, width: w, height: h })
    } catch { if (meta.signatureName) page.drawText(meta.signatureName, { x: M + 124, y: y + 1, size: 11, font: bold, color: INK }) }
  }
  // Printed name of the person who signed/filled the form.
  if (meta.signatureName) { y -= 13; draw(`Printed name: ${meta.signatureName}`, M + 8, 8.5, font, INK) }
  y -= 12; box(bTop, y + 4)

  // Important Information
  y -= 24; draw('Important Information:', M + 6, 10, bold, BLUE)
  const bullets = [
    'By returning this form, you authorize PMI Top Florida Properties to collect your payments automatically.',
    'Association payments are drafted on the 1st. If the date falls on a weekend, it drafts the next business day.',
    'Forms must be received by the 10th of the previous month to take effect for the next scheduled payment.',
    'Payments can only be drafted from a U.S. bank or credit union.',
    'If the assessment amount increases or decreases, the new amount updates automatically.',
  ]
  for (const b of bullets) { y -= 14; draw('•', M + 8, 9, font, INK); draw(b, M + 18, 8.5, font, INK) }
  y -= 22; draw(`Questions? Accounts Receivable: (305) 900-5105 · ar@topfloridaproperties.com`, M, 8, font, GREY)
  y -= 11; draw(meta.signatureName ? `Electronically signed by ${meta.signatureName} on ${meta.signedOn ?? meta.generatedOn} via MAIA.` : `Pre-filled by MAIA on ${meta.generatedOn}.`, M, 7.5, font, GREY)

  return await doc.save()
}
