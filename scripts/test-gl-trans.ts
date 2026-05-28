// =====================================================================
// scripts/test-gl-trans.ts
//
// One-shot test of listGlTransactionsByDate against live CINC for LFA's
// operating account (Cash GL 10-1956-00, BankAccountID 48). Confirms
// the schema matches Swagger and returns real bank activity.
//
// USAGE:  npx tsx scripts/test-gl-trans.ts
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
  const { listGlTransactionsByDate, listAssociationBankAccounts } = await import('../lib/integrations/cinc')

  for (const code of ['LFA', 'KGA']) {
    console.log(`\n=== ${code} ===`)
    const banks = await listAssociationBankAccounts(code, { forceRefresh: true })
    for (const b of banks) {
      if (!b.cashGl) continue
      const today = new Date().toISOString().slice(0, 10)
      const from  = new Date(); from.setDate(from.getDate() - 60)
      const fromS = from.toISOString().slice(0, 10)
      console.log(`\n  Bank: ${b.description} (id=${b.id}, cashGl=${b.cashGl})`)
      console.log(`  Range: ${fromS} → ${today}`)
      try {
        const txs = await listGlTransactionsByDate({
          assocCode: code, fromDate: fromS, toDate: today, accountNumber: b.cashGl,
        })
        console.log(`  ${txs.length} transactions (raw credit/debit values):`)
        for (const t of txs.slice(0, 5)) {
          console.log(`    ${t.TransactionDate?.slice(0,10)}  Credit=${t.CreditAmount}  Debit=${t.DebitAmount}  GLTransID=${t.GLTransID}  ${(t.Description ?? '').slice(0, 60)}`)
        }
        if (txs.length > 5) console.log(`    ... and ${txs.length - 5} more`)
      } catch (err) {
        console.log(`  ERROR: ${(err as Error).message}`)
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
