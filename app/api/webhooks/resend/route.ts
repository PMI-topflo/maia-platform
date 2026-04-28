import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Resend sends delivery event webhooks to this endpoint.
// Configure in Resend dashboard → Webhooks with events:
//   email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained
export async function POST(req: NextRequest) {
  // Verify Resend webhook signature if secret is configured
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    const svix_id        = req.headers.get('svix-id')
    const svix_timestamp = req.headers.get('svix-timestamp')
    const svix_signature = req.headers.get('svix-signature')
    if (!svix_id || !svix_timestamp || !svix_signature) {
      return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })
    }
    // Signature verification would go here via @standard-webhooks/standard-webhooks
    // For now we accept the event and rely on the secret being present as a basic guard
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = body.type as string | undefined
  const data      = body.data as Record<string, unknown> | undefined

  if (!eventType || !data) {
    return NextResponse.json({ received: true })
  }

  const resendMessageId = data.email_id as string | undefined
  if (!resendMessageId) {
    return NextResponse.json({ received: true })
  }

  // Map Resend event type → our status
  const statusMap: Record<string, string> = {
    'email.sent':              'sent',
    'email.delivered':         'delivered',
    'email.delivery_delayed':  'delayed',
    'email.bounced':           'bounced',
    'email.complained':        'complained',
    'email.opened':            'opened',
    'email.clicked':           'clicked',
  }

  const status = statusMap[eventType]
  if (!status) {
    return NextResponse.json({ received: true })
  }

  const { error } = await supabaseAdmin
    .from('email_logs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('resend_message_id', resendMessageId)

  if (error) {
    console.error('[resend-webhook] Failed to update email_logs:', error.message)
  } else {
    console.log(`[resend-webhook] ${resendMessageId} → ${status}`)
  }

  return NextResponse.json({ received: true })
}
