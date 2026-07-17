// =====================================================================
// evals/run-intent-eval.ts
//
// Eval harness for MAIA's resident-message intent router
// (lib/intent-classifier.ts). Runs every labeled fixture through the
// REAL classifier (real Haiku call) and reports per-case pass/fail plus
// an accuracy score, so a prompt tweak that quietly breaks "how much do
// I owe → ledger" gets caught before it ships.
//
// USAGE:
//   npx tsx evals/run-intent-eval.ts            # run all fixtures
//   npx tsx evals/run-intent-eval.ts --json     # machine-readable output
//
// COST: one Haiku call per fixture (~30 calls, max_tokens 200). Bounded
// and cheap, but it DOES hit the live Anthropic API — the count is
// printed before running. Needs ANTHROPIC_API_KEY in .env.local.
//
// Exit code: 0 if accuracy >= PASS_THRESHOLD, 1 otherwise (so this can
// gate CI later). Real classifiers aren't 100% — the threshold, not
// perfection, is the contract.
// =====================================================================

import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Load .env.local (same tolerant parser the probe scripts use) ─────
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch {
  // .env.local optional — env may already be populated (e.g. CI secrets)
}

const PASS_THRESHOLD = 0.85   // fail the run below 85% accuracy
const CONCURRENCY    = 4      // small pool — keep well under any rate limit

async function main() {
  const jsonOut = process.argv.includes('--json')
  const { classifyMessageIntent } = await import('../lib/intent-classifier')
  const { INTENT_FIXTURES } = await import('./intent-classifier.fixtures')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set (checked .env.local + env). Cannot run intent eval.')
    process.exit(1)
  }

  if (!jsonOut) {
    console.log(`\n🧪 Intent-router eval — ${INTENT_FIXTURES.length} fixtures, ${INTENT_FIXTURES.length} live Haiku calls\n`)
  }

  interface Row {
    message: string
    expected: string
    acceptable: string[]
    got: string
    confidence: string
    pass: boolean
  }

  // Bounded-concurrency map so ~30 calls finish quickly without a burst.
  const results: Row[] = new Array(INTENT_FIXTURES.length)
  let cursor = 0
  async function worker() {
    while (cursor < INTENT_FIXTURES.length) {
      const i = cursor++
      const fx = INTENT_FIXTURES[i]
      const c = await classifyMessageIntent(fx.message)
      const acceptable = [fx.expected, ...(fx.acceptable ?? [])]
      results[i] = {
        message:    fx.message,
        expected:   fx.expected,
        acceptable: fx.acceptable ?? [],
        got:        c.intent,
        confidence: c.confidence,
        pass:       acceptable.includes(c.intent),
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, INTENT_FIXTURES.length) }, worker))

  const passed   = results.filter(r => r.pass).length
  const accuracy = passed / results.length

  if (jsonOut) {
    console.log(JSON.stringify({ total: results.length, passed, accuracy, threshold: PASS_THRESHOLD, results }, null, 2))
  } else {
    for (const r of results) {
      const mark = r.pass ? '✅' : '❌'
      const altNote = r.acceptable.length ? ` (also ok: ${r.acceptable.join(', ')})` : ''
      const gotNote = r.pass ? r.got : `${r.got}  ✗ expected ${r.expected}${altNote}`
      console.log(`${mark} [${gotNote}] ${r.confidence.padEnd(4)} — "${r.message.slice(0, 62)}"`)
    }
    console.log(`\n${passed}/${results.length} passed — accuracy ${(accuracy * 100).toFixed(1)}% (threshold ${(PASS_THRESHOLD * 100).toFixed(0)}%)`)
    const failures = results.filter(r => !r.pass)
    if (failures.length) {
      console.log(`\n${failures.length} miss(es):`)
      for (const f of failures) console.log(`  • "${f.message}" → got ${f.got}, expected ${f.expected}`)
    }
    console.log(accuracy >= PASS_THRESHOLD ? '\n🎉 PASS' : '\n🔴 BELOW THRESHOLD')
  }

  process.exit(accuracy >= PASS_THRESHOLD ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
