import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { persona, channel = 'web' } = await req.json()
    const sessionId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await supabaseAdmin.from('general_conversations').insert({
      session_id: sessionId,
      persona,
      channel,
      status: 'open',
      language: 'en',
    })
  } catch { /* fire-and-forget */ }
  return NextResponse.json({ ok: true })
}
