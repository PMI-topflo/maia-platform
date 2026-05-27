// =====================================================================
// app/api/admin/cinc/bank-accounts/route.ts
// GET /api/admin/cinc/bank-accounts?assoc=KGA — returns the bank account
// options for the "Pay from" dropdown on the invoice intake card.
// Fetched from CINC's /banking/bankBalances and cached server-side for
// 30 min. See lib/integrations/cinc.ts listAssociationBankAccounts.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listAssociationBankAccounts } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url   = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim()
  const force = url.searchParams.get('refresh') === '1'
  if (!assoc) return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })

  try {
    const all = await listAssociationBankAccounts(assoc, { forceRefresh: force })
    // Debt-service accounts hold restricted funds earmarked for loan /
    // mortgage payments — they're not an available source for vendor
    // invoice payments. Exclude from Karen's dropdown so she can't
    // accidentally route an AP invoice to them. (The audit-note path
    // in push/route.ts still calls the helper directly and gets the
    // unfiltered list, so lookups by ID continue to resolve.)
    const accounts = all.filter(a => !/debt\s*service/i.test(a.description))
    return NextResponse.json({ assoc: assoc.toUpperCase(), accounts })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC bank-accounts fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
