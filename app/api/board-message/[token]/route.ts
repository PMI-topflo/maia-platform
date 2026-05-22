// =====================================================================
// POST /api/board-message/[token]
//
// A board member submits (or revises) their message for the monthly
// report. Public — the unguessable token is the authorization.
//
// Body: { message: string }
// =====================================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LEN = 5000

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  }

  let body: { message?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return NextResponse.json({ error: 'Please write a message.' }, { status: 400 })
  }
  if (message.length > MAX_LEN) {
    return NextResponse.json({ error: `Please keep the message under ${MAX_LEN} characters.` }, { status: 400 })
  }

  const { data: row, error } = await supabaseAdmin
    .from('board_messages')
    .select('id')
    .eq('token', token)
    .maybeSingle()
  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row)   return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })

  const { error: updErr } = await supabaseAdmin
    .from('board_messages')
    .update({ message, submitted_at: new Date().toISOString() })
    .eq('id', row.id)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
