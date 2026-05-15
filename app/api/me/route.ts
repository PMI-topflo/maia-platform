// =====================================================================
// app/api/me/route.ts
// Unified self-edit endpoint for the non-staff personas (owner /
// tenant / board / unit_manager / building_manager). Staff use the
// pre-existing /api/admin/me, which has its own alt_emails handling
// and no approval flow.
//
// GET   → returns the current persona record + any pending email
//         change still awaiting approval.
// PATCH → applies safe-field updates (phone, name, address, …)
//         straight to the persona table, and queues a
//         pending_profile_changes row + emails the staff approver
//         when the user is trying to change their login email.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  type Persona,
  lookupPersonaRecord,
  applySafeFieldUpdates,
  submitProposedEmailChange,
} from '@/lib/profile-change'

export const dynamic = 'force-dynamic'

const NON_STAFF: Persona[] = ['owner', 'tenant', 'board', 'unit_manager', 'building_manager']

async function getSession() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session) return null
  if (!NON_STAFF.includes(session.persona as Persona)) return null
  return session
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await lookupPersonaRecord(session.persona as Persona, {
    userId:          session.userId,
    associationCode: session.associationCode,
  })
  if (!record) return NextResponse.json({ profile: null, persona: session.persona })

  // Any open email-change request?
  const { data: pendingRow } = await supabaseAdmin
    .from('pending_profile_changes')
    .select('id, proposed_value, status, created_at, expires_at')
    .eq('persona',           session.persona)
    .eq('persona_record_id', record.id)
    .eq('field',             'email')
    .eq('status',            'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    persona: session.persona,
    profile: record,
    pending: pendingRow ?? null,
  })
}

interface PatchBody {
  email?:        string | null
  first_name?:   string | null
  last_name?:    string | null
  name?:         string | null
  phone?:        string | null
  phone_2?:      string | null
  address?:      string | null
  company_name?: string | null
}

export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const persona = session.persona as Persona
  const record  = await lookupPersonaRecord(persona, {
    userId:          session.userId,
    associationCode: session.associationCode,
  })
  if (!record) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Split body into safe (immediate) + email (approval-gated).
  const safe: Record<string, string | null> = {}
  for (const key of ['first_name', 'last_name', 'name', 'phone', 'phone_2', 'address', 'company_name'] as const) {
    if (body[key] !== undefined) safe[key] = body[key] ?? null
  }
  const safeRes = await applySafeFieldUpdates(persona, record.id, safe)
  if (!safeRes.ok) return NextResponse.json({ error: safeRes.error }, { status: 400 })

  // Email change?
  let pendingQueued: string | null = null
  let approverNotified = false
  if (typeof body.email === 'string') {
    const proposed = body.email.trim().toLowerCase()
    const current  = (record.current_email ?? '').trim().toLowerCase()
    if (!proposed || !proposed.includes('@')) {
      return NextResponse.json({ error: 'Proposed email is not a valid address' }, { status: 400 })
    }
    if (proposed !== current && !((record.current_email ?? '').toLowerCase().includes(proposed))) {
      const requesterEmail = typeof session.userId === 'string' && session.userId.includes('@')
        ? session.userId.toLowerCase()
        : (record.current_email ?? proposed)
      const { pending_id, sent } = await submitProposedEmailChange(persona, record, proposed, requesterEmail)
      pendingQueued    = pending_id
      approverNotified = sent
    }
  }

  return NextResponse.json({
    ok:                true,
    persona,
    pending_id:        pendingQueued,
    approver_notified: approverNotified,
  })
}
