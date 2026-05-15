// =====================================================================
// app/api/admin/me/route.ts
// GET — return the current staff member's pmi_staff row.
// PATCH — update fields on the current staff member's own row only.
//
// The row is identified via the canonical resolver in
// lib/staff-lookup.ts, so a session minted from a name-derived alias
// (fabio@pmitop.com) still finds the right pmi_staff record.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveStaffByLoginEmail } from '@/lib/staff-lookup'

export const dynamic = 'force-dynamic'

async function getStaffSession(): Promise<{ loginEmail: string } | null> {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') return null
  const loginEmail = typeof session.userId === 'string' && session.userId.includes('@') ? session.userId.toLowerCase() : ''
  if (!loginEmail) return null
  return { loginEmail }
}

export async function GET() {
  const auth = await getStaffSession()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await resolveStaffByLoginEmail(auth.loginEmail)
  if (!row) return NextResponse.json({ profile: null, loginEmail: auth.loginEmail })

  // Re-fetch the full row (resolveStaffByLoginEmail returns a minimal projection).
  const { data, error } = await supabaseAdmin
    .from('pmi_staff')
    .select('id, name, email, personal_email, alt_emails, phone, role, department, active, created_at')
    .eq('id', row.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data, loginEmail: auth.loginEmail })
}

interface PatchBody {
  name?:           string | null
  email?:          string | null
  personal_email?: string | null
  alt_emails?:     string[] | null
  phone?:          string | null
  role?:           string | null
  department?:     string | null
}

function cleanEmailList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out = new Set<string>()
  for (const v of input) {
    if (typeof v !== 'string') continue
    const e = v.trim().toLowerCase()
    if (e && e.includes('@')) out.add(e)
  }
  return [...out]
}

export async function PATCH(req: Request) {
  const auth = await getStaffSession()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const row = await resolveStaffByLoginEmail(auth.loginEmail)
  if (!row) {
    return NextResponse.json({ error: 'No pmi_staff row matches your session. Ask an admin to add you first.' }, { status: 404 })
  }

  // Whitelist editable fields. Active / role-as-promotion stay admin-only;
  // staff can self-edit their identity + contact info.
  const update: Record<string, unknown> = {}
  if (body.name           !== undefined) update.name           = (body.name           ?? '').trim() || null
  if (body.email          !== undefined) update.email          = (body.email          ?? '').trim().toLowerCase() || null
  if (body.personal_email !== undefined) update.personal_email = (body.personal_email ?? '').trim().toLowerCase() || null
  if (body.alt_emails     !== undefined) update.alt_emails     = cleanEmailList(body.alt_emails)
  if (body.phone          !== undefined) update.phone          = (body.phone          ?? '').trim() || null
  if (body.role           !== undefined) update.role           = (body.role           ?? '').trim() || null
  if (body.department     !== undefined) update.department     = (body.department     ?? '').trim() || null

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Sanity: don't let staff blank out their work email — that's how they
  // log in. personal_email and alt_emails can be cleared.
  if ('email' in update && !update.email) {
    return NextResponse.json({ error: 'Work email cannot be empty' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('pmi_staff')
    .update(update)
    .eq('id', row.id)
    .select('id, name, email, personal_email, alt_emails, phone, role, department, active')
    .single()
  if (error) {
    // Most likely cause: unique constraint on email if they tried to switch
    // to one already taken by another staff member.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ profile: data })
}
