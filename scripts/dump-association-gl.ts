// =====================================================================
// scripts/dump-association-gl.ts
//
// Dump the GL account dropdown options for one association, calling
// CINC live (bypassing the in-memory 30-min cache). Used to diff
// against budget screenshots before wiring POST /accounting/expenseItems.
//
// USAGE:
//   npx tsx scripts/dump-association-gl.ts <ASSOC_CODE>
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx < 1) continue
    const key = line.slice(0, eqIdx).trim()
    let val = line.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch (err) {
  console.error('Could not read .env.local:', (err as Error).message)
  process.exit(1)
}

const assoc = process.argv[2]
const filtered = process.argv.includes('--filtered')
if (!assoc) {
  console.error('Usage: npx tsx scripts/dump-association-gl.ts <ASSOC_CODE> [--filtered]')
  process.exit(1)
}

async function main() {
  const { getAssociationBudget, invalidateBudgetCache } = await import('../lib/integrations/cinc')
  invalidateBudgetCache(assoc)
  const all = await getAssociationBudget(assoc, { forceRefresh: true })
  const lines = filtered
    ? all.filter(l => {
        const firstDigit = parseInt(l.number?.[0] ?? '', 10)
        const isExpenseRange = firstDigit >= 5 && firstDigit <= 9
        const hasActivity =
          (l.budget != null && l.budget > 0) ||
          (l.actual != null && Math.abs(l.actual) > 0)
        const isReserveOrSA = /\breserve|special\s*assess/i.test(l.name)
        return isExpenseRange && hasActivity && !isReserveOrSA
      })
    : all

  console.log(`\nAssociation: ${assoc.toUpperCase()}  —  ${lines.length} GL line(s)${filtered ? ` (filtered from ${all.length})` : ''}\n`)

  const fmt = (n: number | null) =>
    n == null ? '—'.padStart(12) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12)

  const header = ['ChartID'.padEnd(10), 'GL#'.padEnd(10), 'Description'.padEnd(50), 'Budget'.padStart(12), 'Actual'.padStart(12), 'Remaining'.padStart(12)].join(' ')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const l of lines) {
    console.log(
      l.id.padEnd(10),
      (l.number ?? '').padEnd(10),
      l.name.slice(0, 50).padEnd(50),
      fmt(l.budget),
      fmt(l.actual),
      fmt(l.remaining),
    )
  }
  console.log('')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
