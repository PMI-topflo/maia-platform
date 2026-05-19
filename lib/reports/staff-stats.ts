// =====================================================================
// lib/reports/staff-stats.ts
//
// Cross-association activity rollup for the staff dashboard. Pulls the
// list of active associations, runs getAssociationStats() in parallel
// for each, and returns both per-association rows and aggregated totals.
// =====================================================================
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  getAssociationStats,
  sumStats,
  type AssociationStats,
} from '@/lib/reports/association-stats'

export type StaffStatsRow = {
  code:  string
  name:  string
  stats: AssociationStats
}

export type StaffStats = {
  windowDays: number
  totals:     AssociationStats
  perAssoc:   StaffStatsRow[]
}

export async function getStaffStats(
  opts: { windowDays?: number } = {},
): Promise<StaffStats> {
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 30, 365))

  const { data: assocs, error } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .order('association_name', { ascending: true })

  if (error || !assocs) {
    return { windowDays, totals: { ...(await getAssociationStats('__none__', { windowDays })) }, perAssoc: [] }
  }

  const rows: StaffStatsRow[] = await Promise.all(
    assocs.map(async (a: { association_code: string; association_name: string | null }) => ({
      code:  a.association_code,
      name:  a.association_name ?? a.association_code,
      stats: await getAssociationStats(a.association_code, { windowDays }),
    })),
  )

  const totals = sumStats(windowDays, rows.map(r => r.stats))
  return { windowDays, totals, perAssoc: rows }
}
