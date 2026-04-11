import { NextRequest, NextResponse } from 'next/server'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new Response(challenge || '', { status: 200 })
  }

  return new Response('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.log('FULL BODY:', JSON.stringify(body, null, 2))

    const change = body?.entry?.[0]?.changes?.[0]?.value
    const message = change?.messages?.[0]

    if (!message) {
      console.log('IGNORED EVENT: no inbound message')
      return NextResponse.json({ status: 'ignored' })
    }

    const from = message.from
    const text = message.text?.body?.trim() || ''

    console.log('FROM:', from)
    console.log('TEXT:', text)

    if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
      console.error('Missing WhatsApp environment variables')
      return NextResponse.json({ status: 'missing_env_vars' }, { status: 500 })
    }

    const replyText = `Welcome to PMI Sticker System 🚗

Reply:
1 - Register Vehicle
2 - Check Status
3 - Contact Support`

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: from,
          text: { body: replyText },
        }),
      }
    )

    const responseText = await response.text()
    console.log('SEND STATUS:', response.status)
    console.log('SEND RESPONSE:', responseText)

    return NextResponse.json({ status: 'replied' })
  } catch (error) {
    console.error('WEBHOOK ERROR:', error)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}