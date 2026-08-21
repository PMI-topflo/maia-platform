// =====================================================================
// lib/application-review-digest.ts
//
// "Applications to review" — the daily digest of applications whose
// documents have arrived but nobody has reviewed them yet (stage
// `not_sent` — see lib/application-dashboard.ts), plus a shorter section
// for ones sent back to the applicant that are worth a look. This is the
// one recurring task the automatic pipeline never removed: every required
// document still needs a human Approve/Refuse before `syncBoardWindow` can
// move `submitted -> under_review` on its own.
//
// User direction, 2026-08-21: "I need to receive daily the list of
// applications that I need to review the info/files/documents uploaded per
// association and per unit with a direct link to the application."
//
// Reuses getApplicationDashboard() rather than re-deriving stage — the
// dashboard's own docstring is the reason: "One library serves all three
// desks, so they cannot disagree." Same branding shape as
// lib/staff-news.ts's Daily News (table-based HTML, same brand colors).
// =====================================================================

import { getApplicationDashboard, type DashboardRow } from '@/lib/application-dashboard'
import { sendEmail } from '@/lib/gmail'

const NAVY   = '#1f2a44'
const ORANGE = '#e85d26'
const AMBER  = '#b45309'

/** Default recipient — the same address BOARD_EMAIL_CC defaults to. One
 *  comma-separated env var to grow the list without a code change. */
const RECIPIENTS = (process.env.APPLICATIONS_REVIEW_RECIPIENTS ?? 'PMI@topfloridaproperties.com')
  .split(',').map(s => s.trim()).filter(Boolean)

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function etDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso))
}

export interface ApplicationReviewDigestData {
  generatedIso: string
  toReview: DashboardRow[]   // stage 'not_sent' — documents on file, nobody's reviewed them
  refused: DashboardRow[]    // stage 'refused' — sent back, worth a glance at what's changed
}

function groupByAssociationThenUnit(rows: DashboardRow[]): { code: string; name: string; units: { unit: string; rows: DashboardRow[] }[] }[] {
  const byAssoc = new Map<string, { name: string; byUnit: Map<string, DashboardRow[]> }>()
  for (const r of rows) {
    if (!byAssoc.has(r.associationCode)) byAssoc.set(r.associationCode, { name: r.associationName, byUnit: new Map() })
    const a = byAssoc.get(r.associationCode)!
    const unitKey = r.unit ?? '—'
    const arr = a.byUnit.get(unitKey); if (arr) arr.push(r); else a.byUnit.set(unitKey, [r])
  }
  return [...byAssoc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, a]) => ({
      code, name: a.name,
      units: [...a.byUnit.entries()].sort((a2, b2) => a2[0].localeCompare(b2[0], undefined, { numeric: true }))
        .map(([unit, rowsForUnit]) => ({ unit, rows: rowsForUnit })),
    }))
}

export async function gatherApplicationReviewDigest(): Promise<ApplicationReviewDigestData> {
  const dash = await getApplicationDashboard({ includeDecided: false })
  return {
    generatedIso: dash.generatedAt,
    toReview: dash.rows.filter(r => r.stage === 'not_sent'),
    refused: dash.rows.filter(r => r.stage === 'refused'),
  }
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease Renewal', additional_occupant: 'Additional Occupant' }

function rowLine(r: DashboardRow, appUrl: string, tone: string): string {
  const link = `${appUrl}/admin/pre-apply/${r.id}`
  const who = r.applicants.length ? esc(r.applicants.join(', ')) : '<span style="color:#9ca3af">no applicant name on file</span>'
  const type = TYPE_LABEL[r.type] ?? r.type
  return `<tr><td style="padding:9px 0;border-top:1px solid #f3f4f6">
    <div style="font-size:13.5px;font-weight:700;color:${NAVY}">${who} <span style="font-weight:400;color:#6b7280">· ${esc(type)}</span></div>
    <div style="font-size:12.5px;color:${tone};margin-top:2px">${esc(r.detail)}</div>
    <div style="margin-top:5px"><a href="${esc(link)}" style="font-size:12.5px;font-weight:700;color:${ORANGE};text-decoration:none">Open application &rarr;</a></div>
  </td></tr>`
}

function groupBlock(title: string, subtitle: string, rows: DashboardRow[], appUrl: string, tone: string): string {
  if (!rows.length) return ''
  const groups = groupByAssociationThenUnit(rows)
  return `<tr><td style="padding:18px 28px 0">
    <div style="font-size:11px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:.03em">${esc(title)} <span style="color:#9ca3af;font-weight:600;text-transform:none">(${rows.length})</span></div>
    <div style="font-size:12px;color:#6b7280;margin:2px 0 8px">${esc(subtitle)}</div>
    ${groups.map(g => `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:10px">
        <div style="font-size:13px;font-weight:800;color:${NAVY}">${esc(g.name)}</div>
        ${g.units.map(u => `
          <div style="margin-top:6px">
            <div style="font-size:11.5px;font-weight:700;color:#6b7280">Unit ${esc(u.unit)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              ${u.rows.map(r => rowLine(r, appUrl, tone)).join('')}
            </table>
          </div>`).join('')}
      </div>`).join('')}
  </td></tr>`
}

export function buildApplicationReviewDigestEmail(data: ApplicationReviewDigestData, appUrl: string): { subject: string; html: string; text: string } {
  const dateLabel = etDateLabel(data.generatedIso)
  const total = data.toReview.length + data.refused.length
  const subject = total > 0
    ? `Applications to review — ${data.toReview.length} waiting — ${dateLabel}`
    : `Applications to review — all clear — ${dateLabel}`

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:24px 0"><tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:10px;max-width:600px;width:100%">

    <tr><td style="padding:22px 28px 18px;background:#ffffff;border-bottom:1px solid #ececf0;border-top-left-radius:10px;border-top-right-radius:10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:12px">
          <img src="${esc(appUrl)}/icon-192.png" width="42" height="42" alt="Maia" style="display:block;border-radius:10px" />
        </td>
        <td style="vertical-align:middle">
          <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.05">Maia <span style="color:${ORANGE}">&#10022;</span></div>
          <div style="font-size:11px;color:#6b7280;letter-spacing:0.03em;margin-top:2px">by PMI Top Florida Properties</div>
        </td>
      </tr></table>
      <div style="font-size:13px;color:#6b7280;margin-top:14px">📋 <strong style="color:#0f172a">Applications to review</strong> · ${esc(dateLabel)}</div>
    </td></tr>

    ${total === 0 ? `<tr><td style="padding:24px 28px">
      <div style="font-size:14px;color:#166534;font-weight:600">✓ Nothing waiting on your review today.</div>
    </td></tr>` : ''}

    ${groupBlock('Documents on file — not yet reviewed', 'Uploaded, waiting on a staff Approve/Refuse before the board pipeline can move.', data.toReview, appUrl, AMBER)}
    ${groupBlock('Sent back to the applicant', 'Refused, with a reason — worth a glance once they resubmit.', data.refused, appUrl, '#b42318')}

    <tr><td style="padding:16px 28px 22px;border-top:1px solid #eceff4">
      <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">
        Maia · by PMI Top Florida Properties · <a href="${esc(appUrl)}" style="color:#9ca3af;text-decoration:none">${esc(appUrl.replace(/^https?:\/\//, ''))}</a>
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`

  const textLine = (r: DashboardRow) => `    - ${r.applicants.join(', ') || 'no applicant name'} (${TYPE_LABEL[r.type] ?? r.type}) — ${r.detail} — ${appUrl}/admin/pre-apply/${r.id}`
  const textSection = (title: string, rows: DashboardRow[]) => {
    if (!rows.length) return []
    const groups = groupByAssociationThenUnit(rows)
    return [`${title} (${rows.length})`, ...groups.flatMap(g => [
      g.name, ...g.units.flatMap(u => [`  Unit ${u.unit}`, ...u.rows.map(textLine)]),
    ]), '']
  }
  const text = [
    `Applications to review — ${dateLabel}`,
    '',
    ...(total === 0 ? ['Nothing waiting on your review today.', ''] : []),
    ...textSection('Documents on file — not yet reviewed', data.toReview),
    ...textSection('Sent back to the applicant', data.refused),
    'Maia · by PMI Top Florida Properties',
  ].join('\n')

  return { subject, html, text }
}

export interface SendApplicationReviewDigestResult {
  ok: boolean
  dry?: boolean
  recipients: string[]
  subject: string
  toReviewCount: number
  refusedCount: number
}

export async function sendApplicationReviewDigest(opts: { appUrl: string; dry?: boolean }): Promise<SendApplicationReviewDigestResult> {
  const data = await gatherApplicationReviewDigest()
  const email = buildApplicationReviewDigestEmail(data, opts.appUrl)
  const base = { recipients: RECIPIENTS, subject: email.subject, toReviewCount: data.toReview.length, refusedCount: data.refused.length }
  if (!RECIPIENTS.length) return { ok: false, ...base }
  if (opts.dry) return { ok: true, dry: true, ...base }
  await sendEmail({ to: RECIPIENTS, subject: email.subject, html: email.html, text: email.text })
  return { ok: true, ...base }
}
