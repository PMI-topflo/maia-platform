import { NextRequest, NextResponse } from 'next/server'
import { sendEmail } from '@/lib/gmail'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const { companyName, contactName, email, phone, association } = await req.json()

  if (!companyName || !email) {
    return NextResponse.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
  }

  const recipientName = contactName || companyName
  const coiAssocLine = association
    ? `Additional insured requirements for <strong>${association}</strong> will be provided by our team.`
    : "Your association's additional insured requirements will be provided by our team."
  const coiAssocText = association
    ? `Additional insured requirements for ${association} will be provided by our team.`
    : "Your association's additional insured requirements will be provided by our team."

  // ── Vendor HTML ─────────────────────────────────────────────────────────────
  const vendorHtml = `
    <div style="font-family:Arial,sans-serif;max-width:560px">
      <h2 style="color:#111">Welcome to PMI Top Florida Properties</h2>
      <p>Thank you for your inquiry, <strong>${recipientName}</strong>. To start working with us, please complete the following:</p>

      <h3 style="color:#f97316;font-size:15px;margin-top:24px">📄 Required Documents</h3>

      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <tr>
          <td style="padding:12px 16px;background:#fff8f4;border:1px solid #fed7aa;border-radius:4px">
            <strong style="display:block;margin-bottom:4px">Vendor ACH Authorization Form</strong>
            <span style="font-size:13px;color:#555">Required for electronic payment setup via ACH direct deposit.</span><br/>
            <a href="https://www.pmitop.com/vendor-ach-form.pdf" style="display:inline-block;margin-top:10px;background:#f97316;color:#fff;text-decoration:none;font-size:12px;font-weight:600;padding:7px 16px;border-radius:3px;letter-spacing:0.05em">
              ⬇ Download ACH Form
            </a>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        <tr>
          <td style="padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px">
            <strong style="display:block;margin-bottom:4px">Certificate of Insurance (COI)</strong>
            <span style="font-size:13px;color:#555">Required before any work begins. ${coiAssocLine}</span><br/>
            <span style="font-size:12px;color:#888;margin-top:6px;display:block">Send completed COI to: <a href="mailto:service@topfloridaproperties.com">service@topfloridaproperties.com</a></span>
          </td>
        </tr>
      </table>

      <h3 style="color:#f97316;font-size:15px;margin-top:24px">📬 Contact</h3>
      <ul style="line-height:1.8">
        <li>Billing &amp; ACH: <a href="mailto:billing@topfloridaproperties.com">billing@topfloridaproperties.com</a></li>
        <li>Service Coordination: <a href="mailto:service@topfloridaproperties.com">service@topfloridaproperties.com</a></li>
        <li>Phone: (305) 900-5077</li>
      </ul>
      ${association ? `<p style="margin-top:16px"><strong>Association:</strong> ${association}</p>` : ''}

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="color:#9ca3af;font-size:11px;line-height:1.6;margin:0">
        PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179 · (305) 900-5077<br/>
        You received this email because you submitted a vendor inquiry through our website.<br/>
        To stop receiving emails, reply with "unsubscribe" in the subject line.
      </p>
    </div>
  `

  // ── Vendor plain text ────────────────────────────────────────────────────────
  const vendorText = `Welcome to PMI Top Florida Properties

Thank you for your inquiry, ${recipientName}. To start working with us, please complete the following:

REQUIRED DOCUMENTS
------------------

1. Vendor ACH Authorization Form
   Required for electronic payment setup via ACH direct deposit.
   Download: https://www.pmitop.com/vendor-ach-form.pdf

2. Certificate of Insurance (COI)
   Required before any work begins. ${coiAssocText}
   Send completed COI to: service@topfloridaproperties.com

CONTACT
-------
Billing & ACH:         billing@topfloridaproperties.com
Service Coordination:  service@topfloridaproperties.com
Phone:                 (305) 900-5077
${association ? `\nAssociation: ${association}` : ''}

--
PMI Top Florida Properties · 1031 Ives Dairy Road Suite 228, Miami, FL 33179
You received this email because you submitted a vendor inquiry through our website.
To unsubscribe, reply with "unsubscribe" in the subject line.
`

  // ── Internal notification ────────────────────────────────────────────────────
  const internalHtml = `
    <h2 style="color:#111;font-family:Arial,sans-serif">New Vendor Inquiry</h2>
    <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:500px">
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:140px">Company</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${companyName}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Contact</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${contactName || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${email}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${phone || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f5f5;font-weight:600">Association</td><td style="padding:8px 12px">${association || '—'}</td></tr>
    </table>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#888;margin-top:16px">Submitted via MAIA homepage vendor inquiry form.</p>
  `

  const hasProvider = process.env.RESEND_API_KEY || (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN)

  if (!hasProvider) {
    console.warn('[vendor-inquiry] No email provider configured — skipping email send', { companyName, email })
    return NextResponse.json({ ok: true, skipped: true })
  }

  const msgId = randomUUID()

  const results = await Promise.allSettled([
    sendEmail({
      to: email,
      subject: `Welcome to PMI Top Florida Properties — Next Steps for ${companyName}`,
      html: vendorHtml,
      text: vendorText,
      replyTo: 'maia@pmitop.com',
      headers: { 'X-Entity-Ref-ID': msgId },
    }),
    sendEmail({
      to: 'maia@pmitop.com',
      subject: `[Vendor Inquiry] ${companyName} — ${association || 'No association'}`,
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

  return NextResponse.json({ ok: true })
}
