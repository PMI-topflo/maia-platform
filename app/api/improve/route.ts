// =====================================================================
// app/api/improve/route.ts
//
// POST a "make MAIA better" idea — the destination of the per-person link
// in the daily-news email. Public (the link is internal-only but carries
// no session), so we validate hard and cap length. Lands in
// maia_improvement_ideas with status 'new' for triage on /admin/ideas.
// =====================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const MAX_IDEA = 4000
const MAX_NAME = 120

export async function POST(req: Request) {
  let body: { idea?: unknown; name?: unknown; email?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const idea = typeof body.idea === 'string' ? body.idea.trim() : ''
  if (idea.length < 3)        return NextResponse.json({ error: 'Please describe your idea.' }, { status: 400 })
  if (idea.length > MAX_IDEA) return NextResponse.json({ error: 'That idea is too long.' }, { status: 400 })

  const name  = typeof body.name === 'string'  ? body.name.trim().slice(0, MAX_NAME) : null
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200)     : null

  const { error } = await supabaseAdmin.from('maia_improvement_ideas').insert({
    idea,
    submitted_by_name:  name || null,
    submitted_by_email: email || null,
    source:             'daily_news',
    status:             'new',
  })
  if (error) {
    console.error('[improve] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save your idea — please try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
