// GET /api/units/unit?account=MANXI604[&assoc=CODE]
// Full record for one unit for the audit portal: owner/occupancy/tenant,
// required-vs-on-file docs, balance + collections, and pending manager
// upload submissions.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildAssociationAudit } from '@/lib/association-audit'
import { listCurrentBalances } from '@/lib/integrations/cinc'
import { collectionsAccountsFor } from '@/lib/owner-ledger-flow'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const account = (url.searchParams.get('account') || '').trim()
  const auth = await resolveUnitsAuth(url.searchParams.get('assoc'))
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 })

  if (auth.managedUnits && !auth.managedUnits.includes(account)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const audit = await buildAssociationAudit(auth.assoc)
  const unit = audit.find(u => u.accountNumber.toUpperCase() === account.toUpperCase())
  if (!unit) return NextResponse.json({ error: 'unit not found' }, { status: 404 })

  const [balances, collSet, subs, assocRow] = await Promise.all([
    listCurrentBalances(auth.assoc).catch(() => new Map<string, number>()),
    collectionsAccountsFor(auth.assoc).catch(() => new Set<string>()),
    supabaseAdmin.from('unit_document_submissions')
      .select('id, item_key, scope, filename, storage_key, submitted_by_persona, submitted_by_name, ai_verdict, ai_identified_as, ai_expiration_date, ai_summary, status, reviewed_by, reviewed_at, review_note, created_at')
      .eq('association_code', auth.assoc).eq('unit_ref', account).order('created_at', { ascending: false }),
    supabaseAdmin.from('associations').select('association_name').eq('association_code', auth.assoc).maybeSingle(),
  ])

  return NextResponse.json({
    associationCode: auth.assoc,
    associationName: assocRow.data?.association_name ?? auth.assoc,
    persona:         auth.persona,
    canUpload:       auth.canUpload,
    canReview:       auth.canReview,
    unit: {
      ...unit,
      balance:       balances.get(account.toUpperCase()) ?? null,
      inCollections: collSet.has(account.toUpperCase()),
    },
    submissions: subs.data ?? [],
  })
}
