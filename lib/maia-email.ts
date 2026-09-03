// =====================================================================
// lib/maia-email.ts
//
// The STANDARD resident-facing MAIA email (see memory: every owner/tenant/
// applicant email carries PMI branding + association legal name + property
// address + applicant names + a brief "What is MAIA?" blurb + PMI footer).
// Use renderMaiaEmail() for the document-request flow and any other
// resident-facing MAIA email so they all look the same.
//
// This used to also show a "Prefer to just forward an email instead? ...
// @maia upapp <ACCOUNT>" footer, inviting the reader to send a document that
// way. User correction, 2026-09-03: that command was only ever meant for
// STAFF to file correspondence (a forwarded board/tenant/agent thread) into
// an application's Communication history — it stores the email body text
// and the attachment FILE NAMES, never the attachment content itself. An
// applicant (Mark Leguizamon, MANXI 613) followed the footer's instructions
// to send a vehicle insurance photo, got MAIA's "Filed in the communication
// history" confirmation, and the actual document was nowhere staff could
// find or approve it — just a lost filename in a text log. Removed rather
// than fixed to actually save attachments: even if it did, an email with no
// document-type picker can't reliably tell which checklist slot a photo
// belongs to, which is exactly what /pre-apply's real upload flow is for.
// =====================================================================

const esc = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const SUPPORT = 'support@topfloridaproperties.com'

export interface MaiaEmailCtx {
  associationName: string                 // legal name, e.g. "The Manors of Inverrary XI Association, Inc."
  associationCode?: string | null
  unit?: string | null            // bare unit number (NOT the full address)
  propertyAddress: string | null          // full unit address
  applicantNames: string[]
  applicationType?: string | null         // human label, e.g. "Lease Renewal"
  heading: string
  intro: string
  /** `note` explains what the document actually is; `exampleUrl` links a real
   *  example of it. Both exist because "Please send me an example of this
   *  document you want" was the most common reply to this email. */
  items?: { label: string; whoFor?: string | null; note?: string | null; exampleUrl?: string | null }[]
  ctaUrl?: string | null
  ctaLabel?: string | null
  footerReason?: string | null
  onFile?: { label: string; note: string | null; expired?: boolean }[]   // already-received items + expiry
  alsoRequested?: { who: string; items: string[] } | null                // "we also emailed the tenant for X"
}

/** Render the standard MAIA email as an HTML string. */
export function renderMaiaEmail(c: MaiaEmailCtx): string {
  const assoc = c.associationCode ? `${esc(c.associationName)} (${esc(c.associationCode)})` : esc(c.associationName)
  const rows: string[] = [
    `<tr><td style="width:96px;color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 12px;background:#faf8f4">Association</td><td style="padding:8px 12px;font-weight:600;color:#1c2333">${assoc}</td></tr>`,
  ]
  if (c.propertyAddress) rows.push(`<tr><td style="color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 12px;border-top:1px solid #f2efe8">Property</td><td style="padding:8px 12px;font-weight:600;color:#1c2333;border-top:1px solid #f2efe8">${esc(c.propertyAddress)}</td></tr>`)
  if (c.applicantNames.length) rows.push(`<tr><td style="color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 12px;border-top:1px solid #f2efe8">Applicant</td><td style="padding:8px 12px;font-weight:600;color:#1c2333;border-top:1px solid #f2efe8">${esc(c.applicantNames.join(', '))}</td></tr>`)
  if (c.applicationType) rows.push(`<tr><td style="color:#8a8f9a;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;padding:8px 12px;border-top:1px solid #f2efe8">Application</td><td style="padding:8px 12px;font-weight:600;color:#1c2333;border-top:1px solid #f2efe8">${esc(c.applicationType)}</td></tr>`)

  const itemsHtml = c.items && c.items.length
    ? `<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a8f9a;margin:0 0 8px">Please upload</div>
       <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e7e2d9;border-radius:10px;overflow:hidden;margin:0 0 20px">
         ${c.items.map((it, i) => `<tr><td style="padding:11px 15px;font-size:14.5px;color:#1c2333;font-weight:600;${i ? 'border-top:1px solid #f2efe8' : ''}">${esc(it.label)}${it.whoFor ? ` <span style="float:right;font:700 10.5px system-ui;text-transform:uppercase;color:#c0571a;background:#f8efe6;border-radius:999px;padding:3px 9px">${esc(it.whoFor)}</span>` : ''}${it.note ? `<div style="font-weight:400;font-size:12.5px;color:#6b7280;margin-top:3px;line-height:1.45">${esc(it.note)}</div>` : ''}${it.exampleUrl ? `<div style="margin-top:5px"><a href="${it.exampleUrl}" style="font:600 12.5px system-ui;color:#2563eb;text-decoration:none">📎 See an example of this document →</a></div>` : ''}</td></tr>`).join('')}
       </table>`
    : ''

  const onFileHtml = c.onFile && c.onFile.length
    ? `<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a8f9a;margin:0 0 8px">Already on file</div>
       <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e7e2d9;border-radius:10px;overflow:hidden;margin:0 0 20px">
         ${c.onFile.map((it, i) => `<tr><td style="padding:10px 15px;font-size:13.5px;color:#1c2333;${i ? 'border-top:1px solid #f2efe8' : ''}"><span style="color:${it.expired ? '#b91c1c' : '#15803d'};font-weight:700">${it.expired ? '⚠' : '✓'}</span> ${esc(it.label)}${it.note ? ` <span style="float:right;font-size:12px;color:${it.expired ? '#b91c1c' : '#8a8f9a'}">${esc(it.note)}</span>` : ''}</td></tr>`).join('')}
       </table>`
    : ''

  const alsoHtml = c.alsoRequested && c.alsoRequested.items.length
    ? `<div style="font-size:13px;color:#3f4756;background:#eef4fb;border-radius:8px;padding:11px 13px;margin:0 0 20px">📨 We've also emailed <b>${esc(c.alsoRequested.who)}</b> requesting: ${c.alsoRequested.items.map(esc).join(', ')}.</div>`
    : ''

  const cta = c.ctaUrl
    ? `<div style="text-align:center;margin:6px 0 22px"><a href="${esc(c.ctaUrl)}" style="display:inline-block;background:#c0571a;color:#fff;font:700 15px system-ui;text-decoration:none;padding:14px 30px;border-radius:10px">${esc(c.ctaLabel ?? 'Upload your documents →')}</a><div style="font-size:12px;color:#8a8f9a;margin-top:9px">Secure link · unique to you · no login needed</div></div>`
    : ''

  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#eceef2;padding:24px 12px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7e2d9;border-radius:12px;padding:30px 34px 26px">
      <div style="font:700 11px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#c0571a;margin-bottom:10px">PMI Top Florida Properties</div>
      <h1 style="font:800 24px/1.2 Georgia,serif;color:#1c2333;margin:0 0 12px">${esc(c.heading)}</h1>
      <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e7e2d9;border-radius:10px;overflow:hidden;margin:0 0 20px">${rows.join('')}</table>
      <p style="font-size:14.5px;color:#3f4756;margin:0 0 16px">${esc(c.intro)}</p>
      ${itemsHtml}
      ${cta}
      ${alsoHtml}
      ${onFileHtml}
      <div style="display:flex;gap:12px;background:#f8efe6;border-radius:10px;padding:14px 16px;margin:0 0 20px">
        <div style="font-size:22px;line-height:1">✦</div>
        <div style="font-size:13px;color:#3f4756"><b style="color:#c0571a">What is MAIA?</b> MAIA is PMI Top Florida Properties' document assistant. It keeps your association paperwork organized and secure and flags anything expiring — so approvals move faster for you.</div>
      </div>
      <div style="border-top:1px solid #e7e2d9;padding-top:16px;font-size:12px;color:#8a8f9a;line-height:1.6">
        <b style="color:#3f4756">PMI Top Florida Properties</b> — for ${esc(c.associationName)}.<br>
        Questions? Reply to this email or contact <a href="mailto:${SUPPORT}" style="color:#c0571a">${SUPPORT}</a>.${c.footerReason ? `<br>${esc(c.footerReason)}` : ''}
      </div>
    </div>
  </div>`
}
