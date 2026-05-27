// =====================================================================
// scripts/dump-all-bank-accounts.ts
//
// One-shot: dump every association's bank accounts (Operating, Reserve,
// Special Assessment, etc.) — the exact options Karen will see in the
// invoice-intake "Pay from" dropdown.
//
// USAGE:  npx tsx scripts/dump-all-bank-accounts.ts
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
} catch (e) { console.error('env load failed:', e); process.exit(1) }

const ASSOCS = [
  'ABBOTT','KGA','BHB','CHV','ESSI','FIFTH','GVH','GK7','LFA','LCLUB',
  'MACO','MANXI','ONE','PVV','SP','SHORE','VPCI','VPCII','VPC5','VPREC',
  'WBP','WBPA','KANE','ISLAND','DELA',
] as const

async function main() {
  const { listAssociationBankAccounts } = await import('../lib/integrations/cinc')
  for (const code of ASSOCS) {
    try {
      const accts = await listAssociationBankAccounts(code, { forceRefresh: true })
      if (accts.length === 0) {
        console.log(`\n${code.padEnd(8)}  — no bank accounts returned`)
        continue
      }
      console.log(`\n${code}`)
      for (const a of accts) {
        const fmt = (n: number | null) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const flag = a.restricted ? `  [RESTRICTED: ${a.restrictionLabel}]` : ''
        console.log(
          `  id=${String(a.id).padEnd(5)}` +
          `  kind=${a.kind.padEnd(10)}` +
          `  last4=${(a.last4 ?? '----').padEnd(6)}` +
          `  bank=$${fmt(a.bankBalance).padStart(12)}` +
          `  desc="${a.description}"${flag}`,
        )
      }
    } catch (err) {
      console.log(`\n${code}  — ERROR: ${(err as Error).message}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
