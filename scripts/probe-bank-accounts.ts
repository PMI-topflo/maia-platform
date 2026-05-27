// =====================================================================
// scripts/probe-bank-accounts.ts
//
// One-shot read-only probe: GET /management/associations/1/associationBankAccounts
// to see what funding-source options each association exposes
// (Operating, Reserve, Special Assessment, etc.).
//
// USAGE:
//   npx tsx scripts/probe-bank-accounts.ts <ASSOC_CODE>
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
if (!assoc) {
  console.error('Usage: npx tsx scripts/probe-bank-accounts.ts <ASSOC_CODE>')
  process.exit(1)
}

async function main() {
  const { default: fetch } = await import('node-fetch') as any
  const tokenRes = await fetch(process.env.CINC_AUTH_URL ?? 'https://identityserver.cincsys.io/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.CINC_CLIENT_ID!,
      client_secret: process.env.CINC_CLIENT_SECRET!,
      scope:         process.env.CINC_SCOPE ?? 'cincapi.all',
    }),
  })
  const tokenJson = await tokenRes.json() as { access_token?: string; error?: string }
  if (!tokenJson.access_token) throw new Error(`auth failed: ${JSON.stringify(tokenJson)}`)

  const base = (process.env.CINC_API_BASE ?? 'https://PMITFP.cincsys.com/api').replace(/\/$/, '')
  const url = `${base}/management/1/banking/bankBalances?assocCode=${encodeURIComponent(assoc)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenJson.access_token}` } })
  const accounts = await res.json() as any[]
  console.log(`Association: ${assoc.toUpperCase()}  —  ${accounts.length} bank account(s)\n`)
  console.log('id'.padEnd(6), 'reserve'.padEnd(9), 'cashGL'.padEnd(13), 'description'.padEnd(45), 'balance'.padStart(12))
  console.log('-'.repeat(95))
  for (const a of accounts) {
    console.log(
      String(a.BankAccountID).padEnd(6),
      String(a.Reserve).padEnd(9),
      String(a.CashAccountNumber ?? '').padEnd(13),
      String(a.AccountDescription ?? '').slice(0, 45).padEnd(45),
      (typeof a.BankBalance === 'number' ? a.BankBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—').padStart(12),
    )
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
