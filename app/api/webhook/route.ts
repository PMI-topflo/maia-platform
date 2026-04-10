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
  const body = await req.json()

  console.log('Incoming message:', JSON.stringify(body, null, 2))

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]

  if (!message) {
    console.log('No inbound message found in payload')
    return NextResponse.json({ status: 'no message' })
  }

  const from = message.from
  const text = message.text?.body?.trim() || ''

  console.log('From:', from)
  console.log('Text:', text)

  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
  const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error('Missing WhatsApp environment variables')
    return NextResponse.json(
      { status: 'missing_env_vars' },
      { status: 500 }
    )
  }

  let replyText = `Welcome to PMI Sticker System 🚗

Reply:
1 - Register a vehicle
2 - Order sticker
3 - Contact management`

  if (text === '1') {
    replyText = 'Please enter your unit number.'
  } else if (text === '2') {
    replyText = 'Please enter the number of stickers you want to order.'
  } else if (text === '3') {
    replyText = 'A management team member will contact you shortly.'
  }

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
  console.log('WhatsApp send status:', response.status)
  console.log('WhatsApp send response:', responseText)

  return NextResponse.json({ status: 'replied' })
}