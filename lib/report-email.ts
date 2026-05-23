// =====================================================================
// lib/report-email.ts
//
// Builds the HTML email body for a published monthly report. Email-safe
// markup (tables, inline styles — no flexbox/grid/CSS variables) so it
// renders in Gmail, Outlook, and Apple Mail. Returns subject + html +
// a plaintext fallback.
//
// Content layout:
//   - Navy hero with brand line + report title + month
//   - Stat strip (totals from the month)
//   - Personalized greeting + the first ~3 narrative sections
//   - Two CTAs: "Read the full report" → /report/[id]
//               "Rate this report ★"    → /report-feedback/[token]
//   - Slim footer
// =====================================================================

import { monthLabel as fmtMonth, type ActivityTotals } from '@/lib/monthly-report'

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'

export interface BuildReportEmailArgs {
  scopeLabel:     string
  month:          string                // 'YYYY-MM'
  totals:         ActivityTotals
  reportMarkdown: string
  recipientName:  string
  viewUrl:        string                // /report/[id]
  feedbackUrl:    string                // /report-feedback/[token]
  appUrl:         string
}

export function buildReportEmail(a: BuildReportEmailArgs): { subject: string; html: string; text: string } {
  const subject = `Monthly Report — ${a.scopeLabel} · ${fmtMonth(a.month)}`
  const html    = buildHtml(a)
  const text    = buildText(a)
  return { subject, html, text }
}

// ─────────────────────────────────────────────────────────────────────
// HTML — table-based layout, inline styles
// ─────────────────────────────────────────────────────────────────────

function buildHtml(a: BuildReportEmailArgs): string {
  const preview = previewSections(a.reportMarkdown, 3)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(`Monthly Report — ${a.scopeLabel}`)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:10px;max-width:600px;width:100%">

      <!-- Hero -->
      <tr><td style="background:${NAVY};padding:24px 28px;color:#ffffff;border-top-left-radius:10px;border-top-right-radius:10px">
        <div style="font-size:11px;letter-spacing:0.1em;color:#aab3c5;text-transform:uppercase">PMI Top Florida Properties</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px;color:#ffffff">Monthly Management Report</div>
        <div style="font-size:14px;color:#d7dbe4;margin-top:2px">${esc(a.scopeLabel)} · ${esc(fmtMonth(a.month))}</div>
      </td></tr>

      <!-- Stat strip -->
      <tr><td style="padding:18px 28px 6px">
        <table role="presentation" cellpadding="0" cellspacing="4" border="0" width="100%">
          <tr>
            ${statCell(a.totals.ticketsReceived,      'Tickets recd')}
            ${statCell(a.totals.ticketsClosed,        'Tickets closed')}
            ${statCell(a.totals.workOrdersReceived,   'Work orders')}
            ${statCell(a.totals.workOrdersClosed,     'WOs closed')}
            ${statCell(a.totals.emailThreadsReceived, 'Email threads')}
          </tr>
        </table>
      </td></tr>

      <!-- Greeting + section preview -->
      <tr><td style="padding:14px 28px 0">
        <p style="font-size:14px;color:#3a3f4a;margin:0">Hi ${esc(a.recipientName)},</p>
        <p style="font-size:14px;color:#3a3f4a;margin:8px 0 0">
          Here is the ${esc(fmtMonth(a.month))} management report for ${esc(a.scopeLabel)}.
        </p>
        ${mdToEmailHtml(preview)}
      </td></tr>

      <!-- CTAs -->
      <tr><td style="padding:18px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:10px">
              <a href="${esc(a.viewUrl)}" style="display:inline-block;background:${ORANGE};color:#ffffff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Read the full report</a>
            </td>
            <td>
              <a href="${esc(a.feedbackUrl)}" style="display:inline-block;background:#ffffff;color:${ORANGE};border:1px solid ${ORANGE};padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Rate this report ★</a>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:14px 28px 22px;border-top:1px solid #eceff4">
        <p style="font-size:11px;color:#9ca3af;margin:14px 0 0">
          MAIA · PMI Top Florida Properties · <a href="${esc(a.appUrl)}" style="color:#9ca3af;text-decoration:none">${esc(a.appUrl.replace(/^https?:\/\//, ''))}</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`
}

function statCell(n: number, label: string): string {
  return `<td align="center" valign="middle" style="padding:10px 4px;border:1px solid #e5e7eb;border-radius:6px;background:#ffffff">
    <div style="font-size:20px;font-weight:700;color:${NAVY};line-height:1.1">${n}</div>
    <div style="font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px">${esc(label)}</div>
  </td>`
}

// ─────────────────────────────────────────────────────────────────────
// Markdown → email-safe HTML (very limited subset)
// ─────────────────────────────────────────────────────────────────────

/** First N `## ` sections, joined back as markdown, so the email body
 *  shows the most important parts without bloating. */
function previewSections(md: string, maxSections: number): string {
  const lines = md.split(/\r?\n/)
  const out:   string[] = []
  let count = 0
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (count >= maxSections) break
      count++
    }
    if (count > 0) out.push(line)
  }
  return out.join('\n')
}

function mdToEmailHtml(md: string): string {
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let bullets: string[] = []

  const flushBullets = () => {
    if (bullets.length === 0) return
    out.push(
      `<ul style="margin:8px 0 14px 22px;padding:0;color:#3a3f4a;font-size:14px;line-height:1.55">` +
      bullets.map(b => `<li style="margin:4px 0">${inline(b)}</li>`).join('') +
      `</ul>`,
    )
    bullets = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (/^[-*]\s+/.test(line)) { bullets.push(line.replace(/^[-*]\s+/, '')); continue }
    flushBullets()
    if (!line) continue
    if (line.startsWith('## ')) {
      const text = line.slice(3).replace(/^\d+[.)]\s*/, '')
      out.push(`<h2 style="font-size:16px;color:${NAVY};margin:22px 0 4px;padding-bottom:4px;border-bottom:2px solid ${ORANGE}">${esc(text)}</h2>`)
    } else if (line.startsWith('### ')) {
      out.push(`<h3 style="font-size:14px;color:${NAVY};margin:12px 0 4px">${esc(line.slice(4))}</h3>`)
    } else if (line.startsWith('# ')) {
      out.push(`<h2 style="font-size:18px;color:${NAVY};margin:14px 0 6px">${esc(line.slice(2))}</h2>`)
    } else {
      out.push(`<p style="color:#3a3f4a;font-size:14px;line-height:1.55;margin:8px 0">${inline(line)}</p>`)
    }
  }
  flushBullets()
  return out.join('\n')
}

function inline(raw: string): string {
  return esc(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c] as string))
}

// ─────────────────────────────────────────────────────────────────────
// Plaintext fallback
// ─────────────────────────────────────────────────────────────────────

function buildText(a: BuildReportEmailArgs): string {
  return [
    `Monthly Management Report — ${a.scopeLabel} · ${fmtMonth(a.month)}`,
    '',
    `Hi ${a.recipientName},`,
    '',
    `Read the full report: ${a.viewUrl}`,
    `Rate this report:    ${a.feedbackUrl}`,
    '',
    'MAIA · PMI Top Florida Properties',
  ].join('\n')
}
