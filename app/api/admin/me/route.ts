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

  // Re-fetch the full row using only always-present columns; merge
  // alt_emails from the resolver (it handles the pre-migration case).
  const { data: base, error } = await supabaseAdmin
    .from('pmi_staff')
    .select('id, name, email, personal_email, phone, role, department, active, created_at')
    .eq('id', row.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const data = base ? { ...base, alt_emails: row.alt_emails ?? [] } : null
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

  // Whitelist editable fields. Split alt_emails into its own update so
  // the always-present columns still update if the alt_emails column
  // doesn't exist yet (pre-migration) — we just no-op the alt_emails
  // half in that case.
  const baseUpdate: Record<string, unknown> = {}
  if (body.name           !== undefined) baseUpdate.name           = (body.name           ?? '').trim() || null
  if (body.email          !== undefined) baseUpdate.email          = (body.email          ?? '').trim().toLowerCase() || null
  if (body.personal_email !== undefined) baseUpdate.personal_email = (body.personal_email ?? '').trim().toLowerCase() || null
  if (body.phone          !== undefined) baseUpdate.phone          = (body.phone          ?? '').trim() || null
  if (body.role           !== undefined) baseUpdate.role           = (body.role           ?? '').trim() || null
  if (body.department     !== undefined) baseUpdate.department     = (body.department     ?? '').trim() || null
  const altEmailsUpdate = body.alt_emails !== undefined ? cleanEmailList(body.alt_emails) : null

  if (Object.keys(baseUpdate).length === 0 && altEmailsUpdate === null) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Sanity: don't let staff blank out their work email — that's how they
  // log in. personal_email and alt_emails can be cleared.
  if ('email' in baseUpdate && !baseUpdate.email) {
    return NextResponse.json({ error: 'Work email cannot be empty' }, { status: 400 })
  }

  if (Object.keys(baseUpdate).length > 0) {
    const { error } = await supabaseAdmin.from('pmi_staff').update(baseUpdate).eq('id', row.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  let altEmailsWritten = true
  if (altEmailsUpdate !== null) {
    const { error } = await supabaseAdmin.from('pmi_staff').update({ alt_emails: altEmailsUpdate }).eq('id', row.id)
    if (error) {
      // Most likely pre-migration: column doesn't exist. Tell the user
      // so they can apply the migration; the rest of the save still landed.
      altEmailsWritten = false
      console.warn('[admin/me] alt_emails update failed:', error.message)
    }
  }

  // Re-read base columns to return the final state.
  const { data: base } = await supabaseAdmin
    .from('pmi_staff')
    .select('id, name, email, personal_email, phone, role, department, active')
    .eq('id', row.id)
    .maybeSingle()
  const finalAlt = altEmailsUpdate !== null && altEmailsWritten ? altEmailsUpdate : (row.alt_emails ?? [])
  const data = base ? { ...base, alt_emails: finalAlt } : null
  return NextResponse.json({
    profile: data,
    migration_pending: altEmailsUpdate !== null && !altEmailsWritten,
  })
}
