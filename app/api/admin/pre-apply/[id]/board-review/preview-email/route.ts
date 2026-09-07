// POST /api/admin/pre-apply/[id]/board-review/preview-email
//
// Sends the exact email a board round sends — subject, layout, the
// "final approval" CTA — to ONLY the requesting staff member's own login
// email, never to the real board/on-site manager. User direction,
// 2026-09-07: "I want also to see the email that the board receives for
// final approval, can you make Maia send one only for my email to view?"
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { previewReviewRoundEmail } from '@/lib/board-review-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const toEmail = String(session.userId ?? '').trim()
  if (!toEmail.includes('@')) return NextResponse.json({ error: 'Your session has no email on file.' }, { status: 400 })

  const { sent } = await previewReviewRoundEmail(id, toEmail)
  if (!sent) return NextResponse.json({ error: 'Nothing to preview yet — there is no reviewable application here.' }, { status: 400 })
  return NextResponse.json({ ok: true, to: toEmail })
}
