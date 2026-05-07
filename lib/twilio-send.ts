import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

export async function sendSMS(to: string, body: string): Promise<boolean> {
  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to,
      body,
    })
    return true
  } catch (err) {
    console.error('[SMS]', err)
    return false
  }
}

export async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  const waFrom = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER ?? process.env.TWILIO_PHONE_NUMBER}`
  const waTo   = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
  try {
    await client.messages.create({ from: waFrom, to: waTo, body })
    return true
  } catch (err) {
    console.error('[WhatsApp]', err)
    return false
  }
}

export async function sendWhatsAppOTP(to: string, otpCode: string): Promise<boolean> {
  const templateSid = process.env.TWILIO_OTP_TEMPLATE_SID
  if (!templateSid) throw new Error('TWILIO_OTP_TEMPLATE_SID not set')

  const waFrom = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER ?? process.env.TWILIO_PHONE_NUMBER}`
  const waTo   = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`

  await client.messages.create({
    from:             waFrom,
    to:               waTo,
    contentSid:       templateSid,
    contentVariables: JSON.stringify({ '1': otpCode }),
  })
  return true
}

// ---------------------------------------------------------------------
// Strict variants — return the Twilio message SID and throw on failure.
// Use from interactive surfaces (e.g. the staff dashboard) where the
// caller needs the sid for ticket dedupe and the error needs to surface
// to the user instead of being silently logged.
// ---------------------------------------------------------------------

export async function sendSMSStrict(to: string, body: string): Promise<string> {
  const result = await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER!,
    to,
    body,
  })
  return result.sid
}

export async function sendWhatsAppStrict(to: string, body: string): Promise<string> {
  const waFrom = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER ?? process.env.TWILIO_PHONE_NUMBER}`
  const waTo   = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
  const result = await client.messages.create({ from: waFrom, to: waTo, body })
  return result.sid
}
