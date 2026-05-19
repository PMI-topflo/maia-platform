import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listAllNumbers, listAllUsers } from '@/lib/dialpad'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PmiStaffRow {
  id:             string
  email:          string | null
  personal_email: string | null
  alt_emails:     string[] | null
}

export async function POST() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const users = await listAllUsers()
    const activeUsers = users.filter(u => (u.state ?? '').toLowerCase() === 'active')

    // Load every active staff row once, then match in-memory. The team is
    // small enough that this is much cheaper than per-user lookups.
    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from('pmi_staff')
      .select('id, email, personal_email, alt_emails')
      .eq('active', true)
    if (staffErr) {
      return NextResponse.json({ ok: false, error: staffErr.message }, { status: 500 })
    }
    const staff = (staffRows ?? []) as PmiStaffRow[]
    const staffByEmail = new Map<string, string>()
    for (const s of staff) {
      const all = [s.email, s.personal_email, ...(s.alt_emails ?? [])]
        .filter((e): e is string => typeof e === 'string' && !!e)
        .map(e => e.toLowerCase())
      for (const e of all) {
        if (!staffByEmail.has(e)) staffByEmail.set(e, s.id)
      }
    }

    let mapped = 0
    const now = new Date().toISOString()
    for (const u of activeUsers) {
      const emails = (u.emails ?? []).map(e => e.toLowerCase())
      let staffId: string | null = null
      for (const e of emails) {
        const hit = staffByEmail.get(e)
        if (hit) { staffId = hit; break }
      }
      if (staffId) mapped++

      const { error: upsertErr } = await supabaseAdmin
        .from('staff_dialpad_lines')
        .upsert({
          staff_id:             staffId,
          dialpad_user_id:      String(u.id),
          dialpad_email:        emails[0] ?? null,
          dialpad_phone:        u.phone_numbers?.[0] ?? null,
          dialpad_display_name: u.display_name ?? null,
          active:               true,
          updated_at:           now,
        }, { onConflict: 'dialpad_user_id' })
      if (upsertErr) {
        console.error('[dialpad sync-staff] upsert error:', upsertErr.message)
      }
    }

    const numbers = await listAllNumbers()
    for (const n of numbers) {
      if (!n.number) continue
      const { error: upsertErr } = await supabaseAdmin
        .from('dialpad_numbers')
        .upsert({
          phone_number: n.number,
          status:       n.status      ?? null,
          target_type:  n.target_type ?? null,
          target_id:    n.target_id != null ? String(n.target_id) : null,
          label:        n.label       ?? null,
          updated_at:   now,
        }, { onConflict: 'phone_number' })
      if (upsertErr) {
        console.error('[dialpad sync-staff] number upsert error:', upsertErr.message)
      }
    }

    return NextResponse.json({
      ok:           true,
      usersFound:   activeUsers.length,
      usersMapped:  mapped,
      numbersFound: numbers.length,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
