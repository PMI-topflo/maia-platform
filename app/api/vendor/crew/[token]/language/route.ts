// POST /api/vendor/crew/[token]/language  { lang }
// A crew member, viewing their upload link, saves the chosen language as
// their default — so future SMS/WhatsApp/email come in that language. The
// [token] is the signed crew token (?e=) that identifies the employee.
import { NextResponse } from 'next/server'
import { verifyCrewToken } from '@/lib/crew-token'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LANGUAGES } from '@/lib/recurring-services'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const employeeId = await verifyCrewToken(token)
  if (!employeeId) return NextResponse.json({ error: 'invalid or expired link' }, { status: 401 })

  let b: Record<string, unknown> = {}
  try { b = await req.json() } catch { /* */ }
  const lang = String(b.lang ?? '')
  if (!(LANGUAGES as readonly string[]).includes(lang)) return NextResponse.json({ error: 'unsupported language' }, { status: 400 })

  const { error } = await supabaseAdmin.from('vendor_employees').update({ preferred_language: lang }).eq('id', employeeId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, lang })
}
