// =====================================================================
// POST /api/report-feedback/[token]
//
// Submit (or update) a rating + free-text feedback for a monthly report
// using a tokenized link from the email. Public — the token is the
// credential. Idempotent: repeat submissions overwrite the prior
// rating + feedback.
// =====================================================================

import { NextResponse } from 'next/server'

import { submitFeedback, getFeedbackByToken } from '@/lib/report-feedback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // Validate the token resolves to an actual feedback row before
  // accepting a rating — keeps random POSTs from probing the route.
  const row = await getFeedbackByToken(token)
  if (!row) return NextResponse.json({ error: 'Feedback link not found' }, { status: 404 })

  let body: { rating?: unknown; feedback?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const rating = typeof body.rating === 'number' ? Math.floor(body.rating) : NaN
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be a whole number from 1 to 5' }, { status: 400 })
  }
  const feedback = typeof body.feedback === 'string' ? body.feedback : ''

  const result = await submitFeedback(token, rating, feedback)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ ok: true })
}
