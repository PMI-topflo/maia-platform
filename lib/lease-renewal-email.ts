// =====================================================================
// lib/lease-renewal-email.ts
//
// The resident-facing "lease ending / lease ended" emails. One button per
// real answer, so the click IS the answer — each button deep-links to the
// check-in page (/lease-renewal/[token]) with the choice preselected; the
// page asks for one confirming click (so mail-security link scanners that
// follow every URL cannot answer on the person's behalf).
//
// Replaces the single "Tell us what's next" button (user, 2026-09-14: "this
// button is terrible — nobody understands, create something that makes an
// action to click"; the owner of MANXI 911 had replied by email instead).
// Used by app/api/cron/expired-leases-digest (after the end date) and
// app/api/cron/lease-renewal-alerts (30 and 7 days before).
// =====================================================================

const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) }

export type Phase = 'expiring' | 'expired'
export type Role = 'owner' | 'tenant'

export interface Choice { label: string; hint: string; query: string; tone?: 'primary' | 'neutral' }

/** The buttons each party sees, by phase. `query` is appended to the
 *  check-in link; the page validates it against the same option keys the
 *  API accepts (occupancy / response). */
export function choicesFor(role: Role, phase: Phase): Choice[] {
  if (role === 'owner') {
    return [
      { label: 'The unit is vacant', hint: 'Nobody lives there now.', query: 'occupancy=vacant' },
      { label: 'I live in the unit myself', hint: 'Owner-occupied, no tenant.', query: 'occupancy=owner_occupied' },
      { label: phase === 'expired' ? 'The tenant is staying — renew the lease' : 'The tenant is staying — renew the lease', hint: 'We open the renewal application and send the document list.', query: 'occupancy=leased&response=renew', tone: 'primary' },
      { label: 'A new lease is already signed — send it to us', hint: 'You get a secure upload link.', query: 'occupancy=leased&response=signed' },
    ]
  }
  return phase === 'expired'
    ? [
        { label: 'I am staying — renew my lease', hint: 'We follow up with the next steps.', query: 'response=renew', tone: 'primary' },
        { label: 'I already moved out', hint: 'We update the unit right away.', query: 'response=vacated' },
        { label: 'My new lease is already signed — send it to us', hint: 'You get a secure upload link.', query: 'response=signed' },
      ]
    : [
        { label: 'I am staying — renew my lease', hint: 'We follow up with the next steps.', query: 'response=renew', tone: 'primary' },
        { label: 'I am moving out when the lease ends', hint: 'We update the unit and let the owner know.', query: 'response=vacating' },
        { label: 'My new lease is already signed — send it to us', hint: 'You get a secure upload link.', query: 'response=signed' },
      ]
}

export function leaseRenewalResidentHtml(o: {
  role: Role; phase: Phase; name: string; unit: string; assoc: string; end: string
  /** days until the end (expiring) or since it (expired) */
  days: number
  /** the party's own check-in link, without a query string */
  link: string
}): string {
  const choices = choicesFor(o.role, o.phase)
  const when = o.phase === 'expired'
    ? `ended on <strong>${fmt(o.end)}</strong> — <strong>${o.days} day${o.days !== 1 ? 's' : ''} ago</strong>`
    : `ends on <strong>${fmt(o.end)}</strong> — <strong>in ${o.days} day${o.days !== 1 ? 's' : ''}</strong>`
  const sep = o.link.includes('?') ? '&' : '?'
  const buttons = choices.map(c => {
    const primary = c.tone === 'primary'
    return `<tr><td style="padding:0 0 10px">
      <a href="${esc(o.link)}${sep}${c.query}" style="display:block;text-decoration:none;border-radius:10px;padding:13px 16px;border:1.5px solid ${primary ? '#c0571a' : '#d6d3cd'};background:${primary ? '#c0571a' : '#ffffff'};color:${primary ? '#ffffff' : '#1c2333'}">
        <span style="display:block;font-weight:700;font-size:15px">${esc(c.label)} &rarr;</span>
        <span style="display:block;font-size:12px;margin-top:2px;color:${primary ? '#ffe4d1' : '#6b7280'}">${esc(c.hint)}</span>
      </a></td></tr>`
  }).join('')
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#3a3f4a;line-height:1.5;max-width:560px">
    <p>Dear ${o.name ? esc(o.name) : 'Resident'},</p>
    <p>Our records show the lease for <strong>Unit ${esc(o.unit)}</strong> at <strong>${esc(o.assoc)}</strong> ${when}.</p>
    <p style="font-size:16px;font-weight:700;color:#1c2333;margin:18px 0 10px">What is happening with Unit ${esc(o.unit)}? Click one:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px">${buttons}</table>
    <p style="color:#6b7280;font-size:12px;margin:6px 0 0">One click opens a page where you confirm your answer. Nothing else is needed from you.</p>
    <p style="margin:14px 0 4px">Something else? Reply to this email or call ☎ (305) 900-5077 · ✉ <a href="mailto:PMI@topfloridaproperties.com">PMI@topfloridaproperties.com</a></p>
    <p style="color:#9ca3af;font-size:11px">PMI Top Florida Properties</p>
  </div>`
}
