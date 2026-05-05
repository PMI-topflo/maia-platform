import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const TABLE_MAP: Record<string, string> = {
  conv:   'general_conversations',
  ticket: 'board_tickets',
  email:  'email_logs',
}

const ALLOWED_STATUSES = ['open', 'resolved', 'completed', 'received', 'unidentified']

export async function PATCH(req: NextRequest) {
  let body: { id: string; status: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, status } = body
  if (!id || !status) {
    return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // id format is "conv-<uuid>", "ticket-<uuid>", "email-<uuid>"
  const dashIdx = id.indexOf('-')
  const prefix  = id.slice(0, dashIdx)
  const rawId   = id.slice(dashIdx + 1)

  const table = TABLE_MAP[prefix]
  if (!table) {
    return NextResponse.json({ error: 'Unknown item type' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from(table)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', rawId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
