// =====================================================================
// lib/email-attachment-filter.ts
//
// Vendors put their logo in their email signature; a forwarded thread quotes
// that signature many times over. Gmail exposes each embedded logo as an
// "attachment", so they were being (a) drafted as invoices in intake and
// (b) attached to work orders as photos — flooding both with junk graphics
// (the 2026-06-07 "companyLogo" invoices + the work-order logo spam).
//
// This filter drops those signature/logo/embedded graphics while KEEPING
// real attached PDFs and genuine photos/scans. Shared by invoice intake and
// the work-order photo ingestion so the rule stays in one place.
// =====================================================================

export interface EmailAttachmentLike {
  filename: string
  mimeType?: string
  size?: number
  inline?: boolean   // referenced inline in the HTML body (Content-ID / inline disposition)
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?)$/i
// Explicit logo / signature / letterhead words. NOTE: do NOT treat auto-named
// files (image_1234.jpg, IMG_5678.JPG) as logos — phone cameras name REAL
// photos that way too. Size is the reliable discriminator below.
const LOGO_NAME_RE = /(logo|signature|sig\d*\b|icon|banner|emblem|crest|letterhead)/i

// A standalone attached image at least this big is treated as a real photo/scan.
const REAL_PHOTO_MIN_BYTES  = 40 * 1024
// An INLINE image (embedded in the body) is only kept if it's clearly a real
// photo (mobile clients inline real photos); below this it's a signature graphic.
const INLINE_REAL_MIN_BYTES = 150 * 1024

export function isImageAttachment(a: EmailAttachmentLike): boolean {
  return (a.mimeType ?? '').toLowerCase().startsWith('image/') || IMAGE_EXT_RE.test(a.filename ?? '')
}

/** True for an email-signature / logo / embedded graphic that should NOT be
 *  treated as an invoice or a work-order photo. Only judges IMAGES — PDF
 *  attachments are always real documents and are never filtered here. */
export function isSignatureOrLogoImage(a: EmailAttachmentLike): boolean {
  if (!isImageAttachment(a)) return false
  if (LOGO_NAME_RE.test(a.filename ?? '')) return true                          // explicit logo/signature name
  const size = typeof a.size === 'number' ? a.size : undefined
  if (size != null && size < REAL_PHOTO_MIN_BYTES) return true                  // tiny graphic (signature logo)
  if (a.inline && size != null && size < INLINE_REAL_MIN_BYTES) return true     // embedded + not a big photo
  return false
}

/** Collapse the SAME attachment quoted repeatedly down a forwarded thread
 *  (Gmail surfaces each quoted copy as its own part) to one entry, keyed by
 *  filename+size. Prevents a single photo from being saved/processed 128×. */
export function dedupeAttachments<T extends EmailAttachmentLike>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const a of list) {
    const key = `${a.filename ?? ''}|${a.size ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}
