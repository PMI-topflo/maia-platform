// =====================================================================
// scripts/probe-expense-items.ts
//
// Discovery probe: hit the Swagger JSON spec to learn the exact payload
// shape for POST /accounting/expenseItems before writing the helper.
// Also tries a sample GET-shape via the existing invoice fetch.
//
// Read-only — no writes.
//
// USAGE:
//   npx tsx scripts/probe-expense-items.ts
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

async function main() {
  // Pull Swagger JSON to find the POST /accounting/expenseItems definition.
  console.log('Fetching Swagger spec…\n')
  const swaggerUrl = 'https://integration.cincsys.io/api/swagger/docs/1.40.0'
  const res = await fetch(swaggerUrl)
  if (!res.ok) {
    console.error(`Swagger fetch failed: ${res.status}`)
    process.exit(1)
  }
  const spec = await res.json() as { paths?: Record<string, Record<string, unknown>>; definitions?: Record<string, unknown> }

  // Find the expense-items path
  const expensePaths = Object.keys(spec.paths ?? {}).filter(p => /expenseItem/i.test(p))
  console.log('Matching paths:', expensePaths)

  for (const p of expensePaths) {
    console.log(`\n=== ${p} ===`)
    const methods = spec.paths![p]
    for (const [method, def] of Object.entries(methods)) {
      console.log(`  ${method.toUpperCase()}`)
      const d = def as { summary?: string; description?: string; parameters?: unknown[]; responses?: unknown }
      if (d.summary) console.log(`    summary: ${d.summary}`)
      if (d.description) console.log(`    description: ${d.description}`)
      if (d.parameters) {
        console.log('    parameters:')
        for (const p of d.parameters as Array<Record<string, unknown>>) {
          console.log(`      - ${p.name} (${p.in}, ${p.required ? 'required' : 'optional'}): ${JSON.stringify(p.schema ?? p.type)}`)
        }
      }
    }
  }

  // Look for the request body schema if referenced
  const defs = spec.definitions ?? {}
  const expenseModels = Object.keys(defs).filter(k => /expense/i.test(k))
  console.log('\n=== Definitions matching /expense/i ===')
  for (const m of expenseModels) {
    console.log(`\n  ${m}:`)
    console.log('  ', JSON.stringify(defs[m], null, 2).split('\n').join('\n   '))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
