// POST /api/pre-apply/start
//   { code, type, role, unit, name, email, phone }
// Public: begins a Pre-Application Compliance intake for an association and
// returns a token the applicant uses to upload documents + submit. No account.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createIntake } from '@/lib/preapply'
import { signPreApplyToken } from '@/lib/preapply-token'
import { isApplicationType } from '@/lib/intake-documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let b: { code?: string; type?: string; role?: string; unit?: string; name?: string; email?: string; phone?: string }
  try { b = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const code = String(b.code ?? '').trim().toUpperCase()
  const type = String(b.type ?? '').trim()
  const name = String(b.name ?? '').trim()
  const email = String(b.email ?? '').trim()
  if (!code || !isApplicationType(type)) return NextResponse.json({ error: 'code and a valid application type are required' }, { status: 400 })
  if (!name || !email.includes('@')) return NextResponse.json({ error: 'Please enter your name and a valid email.' }, { status: 400 })

  const { data: assoc } = await supabaseAdmin.from('associations').select('association_code, active').eq('association_code', code).maybeSingle()
  if (!assoc || assoc.active === false) return NextResponse.json({ error: 'This association is not accepting applications online.' }, { status: 404 })

  const created = await createIntake({
    associationCode: code, type, role: String(b.role ?? 'applicant'),
    unitLabel: String(b.unit ?? '').trim() || null,
    applicant: { name, email, phone: String(b.phone ?? '').trim() || null },
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })

  const token = await signPreApplyToken(created.applicationId)
  return NextResponse.json({ ok: true, token })
}
