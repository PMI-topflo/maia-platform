// GET /api/addon/draft/[token]
// Public (token-gated): the drafted reply text for the Gmail add-on's
// copy page. No login — the token is the credential, same as every other
// token-gated page in this app. See lib/addon-draft-views.ts.

import { NextResponse } from 'next/server'
import { getDraftView } from '@/lib/addon-draft-views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!UUID.test(token)) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  const draftText = await getDraftView(token)
  if (draftText === null) return NextResponse.json({ error: 'This draft is no longer available — go back and draft it again.' }, { status: 404 })
  return NextResponse.json({ draftText })
}
