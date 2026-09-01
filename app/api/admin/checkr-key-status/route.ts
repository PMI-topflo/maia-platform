// GET /api/admin/checkr-key-status
//
// Reports ONLY whether CHECKR_API_KEY is a test (ckr_sk_test_) or live
// (ckr_sk_live_) key -- never the key itself. Exists to resolve the one
// remaining gate on flipping any association to maia_checkr: the Vercel var
// is marked Sensitive (unreadable via the dashboard UI or API once set), so
// there was previously no way to confirm which mode was live short of
// triggering a real order and watching what happens. See docs/ROADMAP.md's
// Checkr entry -- this was listed as "offered, not built" until now.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.CHECKR_API_KEY ?? ''
  const mode = !key ? 'unconfigured'
    : key.startsWith('ckr_sk_live_') ? 'live'
    : key.startsWith('ckr_sk_test_') ? 'test'
    : 'unrecognized'

  return NextResponse.json({ mode })
}
