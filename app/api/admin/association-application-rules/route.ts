// =====================================================================
// /api/admin/association-application-rules   (staff-only)
// GET  → list per-association application-eligibility rules (individuals-only,
//        min lease term, rental-frequency caps, post-purchase hold periods).
//        ?all=true includes inactive ones (setup page only); default is
//        active-only (the /apply flow + board review flag reader).
// POST → create/upsert one. rule_key is free text so a brand-new rule for a
//        brand-new association is always just another row, never a migration.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENFORCEMENT_VALUES = ['block', 'warn']

export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  let q = supabaseAdmin.from('association_application_rules').select('*').order('association_code').order('rule_key')
  if (searchParams.get('all') !== 'true') q = q.eq('active', true)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = typeof session.userId === 'string' ? session.userId : 'staff'

  let body: { associationCode?: string; ruleKey?: string; value?: unknown; label?: string; enforcement?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const associationCode = String(body.associationCode ?? '').trim().toUpperCase()
  const ruleKey = String(body.ruleKey ?? '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  const label = String(body.label ?? '').trim()
  const enforcement = body.enforcement === 'block' ? 'block' : 'warn'
  if (!associationCode) return NextResponse.json({ error: 'pick an association' }, { status: 400 })
  if (!ruleKey) return NextResponse.json({ error: 'enter a rule key' }, { status: 400 })
  if (!label) return NextResponse.json({ error: 'enter a label' }, { status: 400 })
  if (body.value === undefined || body.value === null || body.value === '') return NextResponse.json({ error: 'enter a value' }, { status: 400 })
  if (!ENFORCEMENT_VALUES.includes(enforcement)) return NextResponse.json({ error: 'invalid enforcement' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('association_application_rules')
    .upsert({
      association_code: associationCode, rule_key: ruleKey, value: body.value, label, enforcement,
      active: true, created_by: me, updated_at: new Date().toISOString(),
    }, { onConflict: 'association_code,rule_key' })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rule: data })
}
