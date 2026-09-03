// =====================================================================
// lib/redact-sensitive.ts
//
// Real incident, 2026-09-03: an owner used the public /request/[token]
// "Leave us a message" free-text box to relay a tenant's SSN for the credit
// check ("Tim SS# for credit check is 263-92-9108") — the note went straight
// into a plaintext email to staff and into the database, unredacted. MAIA
// never asks for an SSN anywhere; the real background check collects it
// through Checkr's own secure consent flow, never a free-text note. This
// scrubs SSN-shaped numbers out of a free-text field before it's stored or
// emailed, so a well-meaning but misplaced SSN can't leak through an
// unrelated "anything we should know?" box.
// =====================================================================

// XXX-XX-XXXX, "XXX XX XXXX", or 9 bare digits — \b on both ends so a longer
// phone/account/routing number isn't falsely caught mid-string.
const SSN_RE = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g

export function redactSSN(text: string): { text: string; found: boolean } {
  let found = false
  const redacted = text.replace(SSN_RE, () => { found = true; return '[removed — looked like a Social Security Number]' })
  return { text: redacted, found }
}
