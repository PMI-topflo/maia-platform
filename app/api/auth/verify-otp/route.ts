import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { makeSession, signSession, SESSION_COOKIE, COOKIE_MAX_AGE } from '@/lib/session'
import { resolveStaffByLoginEmail } from '@/lib/staff-lookup'
import type { MatchedRole } from '@/app/api/homeowner-lookup/route'

function logLogin(data: Record<string, unknown>) {
  void supabaseAdmin.from('login_history').insert(data)
}

export async function POST(req: NextRequest) {
  const { identifier, code, persona, roleData } = await req.json()

  if (!identifier?.trim() || !code?.trim()) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  const ua = req.headers.get('user-agent') ?? ''

  // Find most recent unexpired, unverified OTP for this identifier
  const { data: otpRows } = await supabaseAdmin
    .from('otp_verifications')
    .select('id, otp_code, expires_at, attempts, role_data, method')
    .eq('identifier', identifier.trim())
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  const otp = otpRows?.[0]

  if (!otp) {
    return NextResponse.json({ ok: false, error: 'No active code found. Please request a new one.' }, { status: 400 })
  }

  // Increment attempts
  await supabaseAdmin
    .from('otp_verifications')
    .update({ attempts: otp.attempts + 1 })
    .eq('id', otp.id)

  // Max 5 attempts
  if (otp.attempts >= 5) {
    logLogin({ event: 'otp_failed', identifier: identifier.trim(), persona, method: otp.method, ip_address: ip, user_agent: ua, success: false, failure_reason: 'max_attempts', role_data: otp.role_data ?? roleData ?? null })
    return NextResponse.json({ ok: false, error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 })
  }

  if (otp.otp_code !== code.trim()) {
    logLogin({ event: 'otp_failed', identifier: identifier.trim(), persona, method: otp.method, ip_address: ip, user_agent: ua, success: false, failure_reason: 'wrong_code', role_data: otp.role_data ?? roleData ?? null })
    return NextResponse.json({ ok: false, error: 'Incorrect code. Please try again.' }, { status: 400 })
  }

  // Mark as verified
  await supabaseAdmin
    .from('otp_verifications')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', otp.id)

  // Build session from role data
  const role = (otp.role_data ?? roleData) as MatchedRole | null
  let userId: string | number = 'unknown'
  let assocCode               = ''
  let displayName             = ''
  let contactName             = ''
  let sessionPersona: 'owner' | 'board' | 'staff' | 'tenant' | 'unit_manager' | 'building_manager' = 'owner'

  if (role) {
    if (role.type === 'staff')            { userId = identifier.trim();          sessionPersona = 'staff';            assocCode = 'PMI' }
    if (role.type === 'owner')            { userId = role.owner_id;              sessionPersona = 'owner';            assocCode = role.association_code; displayName = role.association_name; contactName = [role.firstName, role.lastName].filter(Boolean).join(' ') }
    if (role.type === 'board')            { userId = role.board_member_id;       sessionPersona = 'board';            assocCode = role.association_code; displayName = role.association_name; contactName = [role.firstName, role.lastName].filter(Boolean).join(' ') }
    if (role.type === 'tenant')           { userId = identifier.trim();          sessionPersona = 'tenant';           assocCode = role.association_code; displayName = role.association_name }
    if (role.type === 'unit_manager')     { userId = role.unit_manager_id;       sessionPersona = 'unit_manager';     assocCode = role.association_code; displayName = role.association_name; contactName = [role.firstName, role.lastName].filter(Boolean).join(' ') }
    if (role.type === 'building_manager') { userId = role.building_manager_id;   sessionPersona = 'building_manager'; assocCode = role.association_code; displayName = role.association_name; contactName = [role.firstName, role.lastName].filter(Boolean).join(' ') }
  }

  // For staff, look up their name from pmi_staff via the canonical
  // resolver. Handles email + personal_email + alt_emails AND the
  // name-derived fallback (jane@pmitop.com → "Jane Doe" row), so any
  // legitimate PMI work-address alias resolves to the same identity.
  if (sessionPersona === 'staff' && !contactName) {
    const row = await resolveStaffByLoginEmail(identifier.trim())
    contactName = row?.name ?? ''
  }

  const session  = makeSession({ userId, persona: sessionPersona, associationCode: assocCode, displayName, contactName })
  const token    = await signSession(session)

  logLogin({ event: 'otp_verified', identifier: identifier.trim(), persona: sessionPersona, association_code: assocCode || null, association_name: displayName || null, method: otp.method, ip_address: ip, user_agent: ua, success: true, role_data: role })

  const res = NextResponse.json({ ok: true, role })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly:  true,
    secure:    process.env.NODE_ENV === 'production',
    sameSite:  'strict',
    maxAge:    COOKIE_MAX_AGE,
    path:      '/',
  })
  return res
}
