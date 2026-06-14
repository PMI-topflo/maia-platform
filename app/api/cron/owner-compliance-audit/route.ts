// =====================================================================
// GET /api/cron/owner-compliance-audit
// Scans units for missing required documents and emails owners their
// self-service link, pacing reminders. Two callers:
//   • Vercel cron (Bearer CRON_SECRET) — sends only when OWNER_AUDIT_ENABLED=1.
//   • Staff (session) — dry-run by default; add ?send=1 to actually send.
// Query: ?assoc=CODE (scope), ?dryRun=1, ?send=1, ?limit=N (cap per run).
// Always returns a summary { scanned, needDocs, eligible, sent, dryRun }.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { runOwnerComplianceAudit } from '@/lib/compliance-owner-audit'

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
  // Everything else is a dry-run that reports what WOULD be sent.
  const cronEnabled = process.env.OWNER_AUDIT_ENABLED === '1'
  const wantSend = sp.get('send') === '1' && sp.get('dryRun') !== '1'
  const live = (cron && cronEnabled) || (staff && wantSend)
  const dryRun = !live

  const assoc = sp.get('assoc')
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined

  const result = await runOwnerComplianceAudit({ assoc, dryRun, limit })
  return NextResponse.json({ ...result, dryRun, assoc: assoc ?? 'ALL' })
}
