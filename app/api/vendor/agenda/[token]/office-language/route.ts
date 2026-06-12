// POST /api/vendor/agenda/[token]/office-language  { lang }
// The vendor office, viewing the weekly agenda link, saves the chosen
// language as this recurring service's default — so future agenda emails
// arrive in that language. [token] is the signed agenda token (the service).
import { NextResponse } from 'next/server'
import { verifyAgendaToken } from '@/lib/agenda-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LANGUAGES } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const serviceId = await verifyAgendaToken(token)
  if (!serviceId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let b: Record<string, unknown> = {}
  try { b = await req.json() } catch { /* */ }
  const lang = String(b.lang ?? '')
  if (!(LANGUAGES as readonly string[]).includes(lang)) return NextResponse.json({ error: 'unsupported language' }, { status: 400 })

  const { error } = await supabaseAdmin.from('recurring_services').update({ office_language: lang }).eq('id', serviceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, lang })
}
