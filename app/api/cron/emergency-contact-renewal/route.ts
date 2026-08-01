// =====================================================================
// GET /api/cron/emergency-contact-renewal
// Finds units whose emergency contact is expiring soon or already expired
// (unit.emergency is re-confirmed yearly) and emails the owner their
// self-service link to confirm or update it. Two callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends only when OWNER_AUDIT_ENABLED=1.
//   • Staff (session) — dry-run by default; add ?send=1 to actually send.
// Query: ?assoc=CODE (scope), ?dryRun=1, ?send=1, ?limit=N (cap per run).
// Returns { scanned, eligible, sent, dryRun }.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { runEmergencyContactRenewal } from '@/lib/compliance-owner-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const cron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  const staff = !!session && session.persona === 'staff'
  if (!cron && !staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Live sends: cron only when OWNER_AUDIT_ENABLED=1; staff must pass ?send=1.
  const cronEnabled = process.env.OWNER_AUDIT_ENABLED === '1'
  const wantSend = sp.get('send') === '1' && sp.get('dryRun') !== '1'
  const live = (cron && cronEnabled) || (staff && wantSend)
  const dryRun = !live

  const assoc = sp.get('assoc')
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined

  const result = await runEmergencyContactRenewal({ assoc, dryRun, limit })
  return NextResponse.json({ ...result, dryRun, assoc: assoc ?? 'ALL' })
}
