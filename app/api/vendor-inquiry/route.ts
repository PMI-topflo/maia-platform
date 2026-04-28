import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { logEmail } from '@/lib/email-logger'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const { companyName, contactName, email, phone, association } = await req.json()

  if (!companyName || !email) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
  }

  const recipientName = contactName || companyName

  // ── Look up association address from Supabase ─────────────────────────────
  let assocAddress: string | null = null
  let assocFullName: string | null = association ?? null

  if (association) {
    const { data } = await supabaseAdmin
      .from('associations')
      .select('association_name, principal_address, city, state, zip')
      .eq('association_name', association)
      .single()

    if (data?.principal_address && data?.city && data?.zip) {
      assocFullName  = data.association_name
      assocAddress   = `${data.principal_address}, ${data.city}, ${data.state ?? 'FL'} ${data.zip}`
    }
  }

  // ── COI section blocks ────────────────────────────────────────────────────
  const coiHtmlBlock = assocAddress
    ? `
      <p style="margin:0 0 10px;font-size:13px;color:#374151">Your COI must list the following as <strong>Additional Insured</strong>:</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:13px;color:#111">
            <span style="display:block;font-size:10px;font-weight:700;letter-spacing:0.08em;color:#16a34a;text-transform:uppercase;margin-bottom:4px">Box 1 — Association</span>
            <strong>${assocFullName}</strong><br/>
            <span style="color:#6b7280">${assocAddress}</span>
          </td>
        </tr>
        <tr><td style="padding:4px 0"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:13px;color:#111">
            <span style="display:block;font-size:10px;font-weight:700;letter-spacing:0.08em;color:#16a34a;text-transform:uppercase;margin-bottom:4px">Box 2 — Management Company</span>
            <strong>PMI Top Florida Properties</strong><br/>
            <span style="color:#6b7280">1031 Ives Dairy Road Suite 228, Miami, FL 33179</span>
          </td>
        </tr>
      </table>
      <p style="margin:10px 0 0;font-size:12px;color:#6b7280">Please forward these requirements to your insurance agent.<br/>Send completed COI to: <a href="mailto:service@topfloridaproperties.com" style="color:#f26a1b">service@topfloridaproperties.com</a></p>
    `
    : `
      <p style="margin:0 0 8px;font-size:13px;color:#374151">A Certificate of Insurance is required before any work begins.</p>
      ${association ? `<p style="margin:0 0 8px;font-size:13px;color:#374151">Additional insured requirements for <strong>${association}</strong> will be provided by our team.</p>` : '<p style="margin:0 0 8px;font-size:13px;color:#374151">Our team will provide additional insured requirements for your association.</p>'}
      <p style="margin:0;font-size:12px;color:#6b7280">Send completed COI to: <a href="mailto:service@topfloridaproperties.com" style="color:#f26a1b">service@topfloridaproperties.com</a></p>
    `

  const coiTextBlock = assocAddress
    ? `Your COI must list the following as Additional Insured:

  Box 1 — Association
  ${assocFullName}
  ${assocAddress}

  Box 2 — Management Company
  PMI Top Florida Properties
  1031 Ives Dairy Road Suite 228, Miami, FL 33179

  Please forward these requirements to your insurance agent.
  Send completed COI to: service@topfloridaproperties.com`
    : `A Certificate of Insurance is required before any work begins.
  ${association ? `Additional insured requirements for ${association} will be provided by our team.` : 'Our team will provide additional insured requirements for your association.'}
  Send completed COI to: service@topfloridaproperties.com`

  // ── Vendor HTML ───────────────────────────────────────────────────────────
  const vendorHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

      <!-- Header -->
      <tr>
        <td style="background:#0d0d0d;padding:24px 28px;border-radius:6px 6px 0 0">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.12em;color:#f26a1b;text-transform:uppercase">PMI Top Florida Properties</p>
          <h1 style="margin:6px 0 0;font-size:20px;font-weight:400;color:#ffffff;letter-spacing:0.01em">Vendor Onboarding</h1>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:#ffffff;padding:28px 28px 8px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6">
            Thank you for your inquiry, <strong>${recipientName}</strong>. To start working with us, please complete the steps below.
          </p>

          <!-- Step 1: ACH -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
            <tr>
              <td style="background:#fff8f4;border:1px solid #fed7aa;border-radius:4px;padding:16px 18px">
                <p style="margin:0 0 2px">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#f26a1b;text-transform:uppercase">Step 1 — ACH Payment Setup</span>
                </p>
                <p style="margin:4px 0 10px;font-size:13px;font-weight:600;color:#111">Vendor ACH Authorization Form</p>
                <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.5">Required for electronic payment via ACH direct deposit. Complete and return to <a href="mailto:billing@topfloridaproperties.com" style="color:#f26a1b">billing@topfloridaproperties.com</a>.</p>
                <a href="https://www.pmitop.com/vendor-ach-form.pdf"
                   style="display:inline-block;background:#f26a1b;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;padding:8px 18px;border-radius:3px;letter-spacing:0.05em">
                  ⬇ Download ACH Form
                </a>
              </td>
            </tr>
          </table>

          <!-- Step 2: COI -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
            <tr>
              <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:16px 18px">
                <p style="margin:0 0 2px">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#374151;text-transform:uppercase">Step 2 — Certificate of Insurance</span>
                </p>
                <p style="margin:4px 0 12px;font-size:13px;font-weight:600;color:#111">COI Additional Insured Requirements</p>
                ${coiHtmlBlock}
              </td>
            </tr>
          </table>

          <!-- Step 3: Work Orders -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            <tr>
              <td style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:16px 18px">
                <p style="margin:0 0 2px">
                  <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#374151;text-transform:uppercase">Step 3 — Work Orders &amp; Approvals</span>
                </p>
                <p style="margin:4px 0 8px;font-size:13px;font-weight:600;color:#111">Getting Started on Jobs</p>
                <p style="margin:0;font-size:13px;color:#555;line-height:1.5">All work must be approved before starting. Contact our service team for scope approvals and work orders: <a href="mailto:service@topfloridaproperties.com" style="color:#f26a1b">service@topfloridaproperties.com</a> or <a href="tel:+13059005077" style="color:#f26a1b">(305) 900-5077</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Contact bar -->
      <tr>
        <td style="background:#0d0d0d;padding:16px 28px;border-left:1px solid #0d0d0d;border-right:1px solid #0d0d0d">
          <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:0.1em;color:#f26a1b;text-transform:uppercase">Contact</p>
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:12px;color:#d1d5db;padding-right:20px">
                Billing &amp; ACH<br/>
                <a href="mailto:billing@topfloridaproperties.com" style="color:#f26a1b;text-decoration:none">billing@topfloridaproperties.com</a>
              </td>
              <td style="font-size:12px;color:#d1d5db;padding-right:20px">
                Service &amp; Work Orders<br/>
                <a href="mailto:service@topfloridaproperties.com" style="color:#f26a1b;text-decoration:none">service@topfloridaproperties.com</a>
              </td>
              <td style="font-size:12px;color:#d1d5db">
                Office<br/>
                <a href="tel:+13059005077" style="color:#f26a1b;text-decoration:none">(305) 900-5077</a>
              </td>
              <td style="font-size:12px;color:#d1d5db;padding-left:20px">
                WhatsApp / SMS<br/>
                <a href="https://wa.me/17866863223" style="color:#25d366;text-decoration:none">(786) 686-3223</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:14px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px">
          <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6">
            PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179 · (305) 900-5077<br/>
            You received this email because you submitted a vendor inquiry through our website.
            To stop receiving emails, reply with "unsubscribe" in the subject line.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

  // ── Vendor plain text ─────────────────────────────────────────────────────
  const vendorText = `Welcome to PMI Top Florida Properties — Vendor Onboarding
==========================================================

Thank you for your inquiry, ${recipientName}. To start working with us, please complete the steps below.

STEP 1 — ACH PAYMENT SETUP
---------------------------
Vendor ACH Authorization Form
Required for electronic payment via ACH direct deposit.
Download: https://www.pmitop.com/vendor-ach-form.pdf
Return completed form to: billing@topfloridaproperties.com

STEP 2 — CERTIFICATE OF INSURANCE
-----------------------------------
${coiTextBlock}

STEP 3 — WORK ORDERS & APPROVALS
----------------------------------
All work must be approved before starting.
Contact: service@topfloridaproperties.com | (305) 900-5077

CONTACT
-------
Billing & ACH:        billing@topfloridaproperties.com
Service & Work Orders: service@topfloridaproperties.com
Office:               (305) 900-5077
WhatsApp / SMS:       (786) 686-3223

--
PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179
You received this email because you submitted a vendor inquiry through our website.
To unsubscribe, reply with "unsubscribe" in the subject line.
`

  // ── Internal notification ─────────────────────────────────────────────────
  const internalHtml = `
    <h2 style="color:#111;font-family:Arial,sans-serif">New Vendor Inquiry</h2>
    <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:500px">
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:140px">Company</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${companyName}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Contact</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${contactName || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${email}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${phone || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Association</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${association || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Assoc Address</td><td style="padding:8px 12px">${assocAddress || '—'}</td></tr>
    </table>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#888;margin-top:16px">Submitted via MAIA homepage vendor inquiry form.</p>
  `

  const hasProvider = process.env.RESEND_API_KEY || (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN)

  if (!hasProvider) {
    console.warn('[vendor-inquiry] No email provider configured — skipping email send', { companyName, email })
    return NextResponse.json({ ok: true, skipped: true })
  }

  const msgId = randomUUID()

  const vendorSubject  = `Welcome to PMI Top Florida Properties — Next Steps for ${companyName}`
  const internalSubject = `[Vendor Inquiry] ${companyName} — ${association || 'No association'}`

  const results = await Promise.allSettled([
    sendEmail({
      to: email,
      subject: vendorSubject,
      html: vendorHtml,
      text: vendorText,
      replyTo: 'maia@pmitop.com',
      headers: { 'X-Entity-Ref-ID': msgId },
    }),
    sendEmail({
      to: 'maia@pmitop.com',
      subject: internalSubject,
      html: internalHtml,
    }),
  ])

  results.forEach((r, i) => {
    const label = i === 0 ? `vendor (${email})` : 'internal (maia@pmitop.com)'
    if (r.status === 'fulfilled') {
      console.log(`[vendor-inquiry] Email sent → ${label}`)
    } else {
      console.error(`[vendor-inquiry] Email failed → ${label}:`, r.reason)
    }
  })

  // Log both emails — fire and forget
  if (results[0].status === 'fulfilled') {
    void logEmail({
      toEmail:          email,
      subject:          vendorSubject,
      fullBody:         vendorText,
      persona:          'vendor',
      associationCode:  assocFullName ?? undefined,
      resendMessageId:  results[0].value.messageId,
    })
  }
  if (results[1].status === 'fulfilled') {
    void logEmail({
      toEmail:          'maia@pmitop.com',
      subject:          internalSubject,
      fullBody:         internalHtml,
      persona:          'vendor',
      associationCode:  assocFullName ?? undefined,
      resendMessageId:  results[1].value.messageId,
    })
  }

  return NextResponse.json({ ok: true })
}
