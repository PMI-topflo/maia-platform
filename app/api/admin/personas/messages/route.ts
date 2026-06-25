// =====================================================================
// GET /api/admin/personas/messages?phone=&email=   (staff-only)
//
// A person's communication history, merged across channels:
//   • general_conversations — SMS / WhatsApp / voice / web (by phone/email)
//   • email_logs            — emails (by to/from email)
// Returns one time-sorted timeline so a persona's whole thread is in one view.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface MessageItem {
  channel: 'sms' | 'whatsapp' | 'voice' | 'web' | 'email' | 'other'
  direction: 'inbound' | 'outbound' | null
  when: string | null
  title: string | null
  body: string | null
  /** English translation of `body` when the original was non-English; null otherwise. */
  bodyEn: string | null
  associationCode: string | null
}

const digits = (s: string) => s.replace(/\D/g, '')

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const phone = (url.searchParams.get('phone') ?? '').trim()
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase()
  const last10 = digits(phone).slice(-10)
  if (!last10 && !email) return NextResponse.json({ items: [] })

  const items: MessageItem[] = []

  // ── Conversations (SMS / WhatsApp / voice / web) ──────────────────
  const convOr: string[] = []
  if (last10) convOr.push(`contact_phone.ilike.%${last10}%`)
  if (email)  convOr.push(`contact_email.ilike.%${email}%`)
  if (convOr.length) {
    const { data } = await supabaseAdmin.from('general_conversations')
      .select('channel, association_code, topic, subject, summary, message, body_en, response, created_at')
      .or(convOr.join(',')).order('created_at', { ascending: false }).limit(60)
    for (const c of data ?? []) {
      const ch = String(c.channel ?? '').toLowerCase()
      const channel: MessageItem['channel'] = ch === 'whatsapp' ? 'whatsapp' : ch === 'voice' ? 'voice' : ch === 'sms' ? 'sms' : ch === 'web' ? 'web' : 'other'
      items.push({
        channel, direction: null, when: (c.created_at as string | null) ?? null,
        title: (c.topic as string | null) || (c.subject as string | null) || 'Conversation',
        body: (c.message as string | null) || (c.summary as string | null) || (c.response as string | null) || null,
        bodyEn: (c.body_en as string | null) ?? null,
        associationCode: (c.association_code as string | null) ?? null,
      })
    }
  }

  // ── Emails ────────────────────────────────────────────────────────
  if (email) {
    const { data } = await supabaseAdmin.from('email_logs')
      .select('direction, from_email, to_email, subject, body_preview, created_at')
      .or(`to_email.ilike.%${email}%,from_email.ilike.%${email}%`).order('created_at', { ascending: false }).limit(60)
    for (const e of data ?? []) {
      items.push({
        channel: 'email', direction: (e.direction as 'inbound' | 'outbound' | null) ?? null,
        when: (e.created_at as string | null) ?? null,
        title: (e.subject as string | null) || '(no subject)',
        body: (e.body_preview as string | null) ?? null, bodyEn: null, associationCode: null,
      })
    }
  }

  items.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))
  return NextResponse.json({ items: items.slice(0, 80) })
}
