// =====================================================================
// app/api/admin/cinc/pay-by-types/route.ts
// GET /api/admin/cinc/pay-by-types?assoc=KANE — returns the valid
// PayByType options for an association, sourced from CINC. Backs the
// payment-method dropdown in the invoice intake card.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { listPayByTypes } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url   = new URL(req.url)
  const assoc = (url.searchParams.get('assoc') ?? '').trim()
  if (!assoc) return NextResponse.json({ error: 'assoc query param required' }, { status: 400 })

  try {
    const raw = await listPayByTypes(assoc)
    // Normalise into a uniform {value, label} shape for the dropdown.
    // CINC's response uses inconsistent field names across endpoints
    // — try each plausible source.
    const types = raw.map(t => {
      const value = String(t.PayByType ?? t.PayByTypeName ?? t.Name ?? t.Description ?? '').trim()
      const label = (t.PayByTypeName ?? t.Description ?? t.Name ?? value ?? '').trim()
      return value ? { value, label: label || value } : null
    }).filter((x): x is { value: string; label: string } => !!x)
    return NextResponse.json({ assoc: assoc.toUpperCase(), types })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC payByTypes fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
