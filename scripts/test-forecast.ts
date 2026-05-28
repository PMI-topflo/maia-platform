// =====================================================================
// scripts/test-forecast.ts
//
// One-shot test of forecastEndOfMonthBalance against live CINC for
// LFA + KGA operating accounts. Confirms the recurring detection works
// and the math is sensible.
//
// USAGE:  npx tsx scripts/test-forecast.ts
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const c = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const l of (c.charCodeAt(0)===0xFEFF?c.slice(1):c).split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i < 1) continue
    const k = t.slice(0,i).trim(); let v = t.slice(i+1).trim()
    if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1)
    if (k && !(k in process.env)) process.env[k]=v
  }
} catch (e) { console.error(e); process.exit(1) }

async function main() {
  const { forecastEndOfMonthBalance } = await import('../lib/cash-flow-forecast')

  const cases = [
    { code: 'LFA', acct: 48,  label: 'LFA Operating (CSB 1956)' },
    { code: 'KGA', acct: 76,  label: 'KGA Operating (SSB 8614)' },
  ]

  for (const c of cases) {
    console.log(`\n=== ${c.label} ===`)
    try {
      const f = await forecastEndOfMonthBalance({ assocCode: c.code, bankAccountId: c.acct })
      const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      console.log(`  Current balance:     ${fmt(f.currentBalance).padStart(15)}`)
      console.log(`  Approved unpaid:    -${fmt(f.approvedUnpaid).padStart(14)}  (${f.approvedUnpaidItems.length} MAIA-known invoices)`)
      console.log(`  Recurring projected: -${fmt(f.recurringProjected).padStart(14)}  (${f.recurringVendors.filter(v => v.pendingThisMonth).length} pending vendors)`)
      console.log(`  ───────────────────────────────────────`)
      console.log(`  Projected EOM:       ${(f.projectedEomBalance < 0 ? '-' : ' ') + fmt(Math.abs(f.projectedEomBalance)).padStart(14)}`)
      console.log(`  ${f.willOverdraw ? '🛑 WILL OVERDRAW' : '✓ Positive at month-end'}`)

      if (f.recurringVendors.length > 0) {
        console.log(`\n  Top recurring vendors:`)
        for (const v of f.recurringVendors.slice(0, 8)) {
          const tag = v.pendingThisMonth ? '(pending this month)' : `(last paid ${v.lastSeenMonth})`
          console.log(`    ${fmt(v.avgAmount).padStart(12)}  ${v.monthsSeen}/3 mo  ${tag}  ${v.displayName.slice(0, 60)}`)
        }
      }
      if (f.caveats.length > 0) {
        console.log(`\n  Caveats:`)
        for (const c2 of f.caveats) console.log(`    - ${c2}`)
      }
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
