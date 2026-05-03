// =====================================================================
// lib/email/compliance-digest.ts
//
// Sends the daily compliance digest from maia@mypmitop.com using the
// existing Gmail OAuth setup (GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN).
//
// All output in English regardless of recipient language preference
// (this is a hard rule per project memory).
// =====================================================================

import { google } from 'googleapis';

interface AlertRow {
  account_number: string;
  association_code: string;
  alert_type: string;
  severity: 'warning' | 'urgent' | 'critical';
  expiration_date: string;
  days_delta: number;
  message: string;
}

interface DigestArgs {
  newAlerts: AlertRow[];
  totalActive: number;
}

const STAFF_RECIPIENTS = (process.env.COMPLIANCE_DIGEST_RECIPIENTS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function gmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function buildHtml({ newAlerts, totalActive }: DigestArgs): string {
  const critical = newAlerts.filter(a => a.severity === 'critical');
  const urgent   = newAlerts.filter(a => a.severity === 'urgent');
  const warning  = newAlerts.filter(a => a.severity === 'warning');

  const renderRow = (a: AlertRow) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;font-weight:600">${escapeHtml(a.account_number)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(a.message)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">${escapeHtml(a.expiration_date)}</td>
    </tr>`;

  const section = (title: string, color: string, alerts: AlertRow[]) => alerts.length ? `
    <h3 style="color:${color};margin:24px 0 8px 0;font-family:Arial,sans-serif">${title} (${alerts.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:8px;text-align:left">Account</th>
        <th style="padding:8px;text-align:left">Issue</th>
        <th style="padding:8px;text-align:left">Date</th>
      </tr></thead>
      <tbody>${alerts.map(renderRow).join('')}</tbody>
    </table>` : '';

  return `<!doctype html>
  <html><body style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#0d0d0d">
    <div style="border-left:4px solid #f26a1b;padding-left:16px;margin-bottom:24px">
      <h1 style="margin:0;color:#0d0d0d">PMI Top Florida Properties — Compliance Digest</h1>
      <p style="margin:4px 0;color:#666">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
    </div>
    <p><strong>${newAlerts.length} new alert(s)</strong> generated today. <strong>${totalActive} total active</strong> across all associations.</p>
    ${section('🚨 Critical (already expired)', '#9C0000', critical)}
    ${section('⚠️ Urgent (≤30 days)', '#cc6600', urgent)}
    ${section('⚡ Warning (≤60 days)', '#999900', warning)}
    <p style="margin-top:32px;color:#666;font-size:12px">
      View the full audit dashboard at <a href="https://www.mypmitop.com/admin/audit" style="color:#f26a1b">mypmitop.com/admin/audit</a>.
    </p>
  </body></html>`;
}

export async function sendComplianceDigestEmail(args: DigestArgs) {
  if (args.newAlerts.length === 0) return; // Skip empty digests
  if (STAFF_RECIPIENTS.length === 0) {
    console.warn('[digest] No COMPLIANCE_DIGEST_RECIPIENTS configured');
    return;
  }

  const gmail = gmailClient();
  const html = buildHtml(args);
  const subject = `[PMI Compliance] ${args.newAlerts.length} new alert(s) — ${new Date().toLocaleDateString('en-US')}`;

  const raw = [
    `From: PMI Top Florida Properties <maia@mypmitop.com>`,
    `To: ${STAFF_RECIPIENTS.join(', ')}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64url');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
}
