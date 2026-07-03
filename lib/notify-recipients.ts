// =====================================================================
// lib/notify-recipients.ts
//
// Canonical internal recipients for vendor / work-order / board emails.
//
// Staff are copied via BCC (not CC) so the external recipient — vendor,
// board member, applicant, tenant — never sees them and can't pull them
// into a reply-all. Replies route to the human via Reply-To.
//
//   • Vendor + work-order emails  → BCC Paola + Fabio; replies go to Paola.
//   • Tenant-application board     → BCC Jonathan + Fabio; replies go to Jonathan.
//
// Paola's service@pmitop.com and service@topfloridaproperties.com are the
// same inbox, so we keep the existing topflorida address as canonical.
// =====================================================================

export const PAOLA_EMAIL    = process.env.MAIA_VENDOR_REQUEST_CC ?? 'service@topfloridaproperties.com'
export const FABIO_EMAIL    = process.env.MAIA_OWNER_NOTIFY_EMAIL ?? 'fabio@pmitop.com'
export const JONATHAN_EMAIL = process.env.MAIA_AR_EMAIL ?? 'ar@topfloridaproperties.com'
/** The main MAIA inbox — Gmail-watched, so replies land somewhere that
 *  actually threads back onto the work order automatically. */
export const MAIA_EMAIL = 'maia@pmitop.com'

/** BCC list for vendor + work-order emails (crew links, agenda, estimate/doc
 *  requests, onboarding, estimate-to-board) — staff get a blind copy. */
export const VENDOR_NOTIFY_CC: string[] = [PAOLA_EMAIL, FABIO_EMAIL]
/** Reply-To for vendor + work-order emails — maia@ first so a vendor's
 *  reply auto-threads onto the work order (see ingestInboundEmailToTicket),
 *  Paola also listed so she keeps seeing replies land in her own inbox too. */
export const VENDOR_REPLY_TO: string[] = [MAIA_EMAIL, PAOLA_EMAIL]

/** BCC list for tenant-application board emails — staff get a blind copy. */
export const APPLICATION_NOTIFY_CC: string[] = [JONATHAN_EMAIL, FABIO_EMAIL]
/** Reply-To for tenant-application board emails — replies reach Jonathan (AR). */
export const APPLICATION_REPLY_TO = JONATHAN_EMAIL
