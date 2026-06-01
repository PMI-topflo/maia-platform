// =====================================================================
// scripts/probe-recurring-cadence.ts
// One-shot READ-ONLY probe of recurring_services: what cadence / expected
// day is configured per vendor-service, so we can make coverage flags
// schedule-accurate. No writes.
//   npx tsx scripts/probe-recurring-cadence.ts
// =====================================================================
import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch (err) {
  console.error('Could not read .env.local:', (err as Error).message); process.exit(1)
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

  const { data: svc, error } = await sb
    .from('recurring_services')
    .select('id, association_code, vendor_name, service_type, cadence, billing_cadence, expected_day, active')
    .order('association_code')
  if (error) { console.error('query error:', error.message); process.exit(1) }

  const rows = svc ?? []
  const active = rows.filter(r => r.active)
  console.log(`\nrecurring_services: ${rows.length} total, ${active.length} active\n`)

  const byCad: Record<string, number> = {}
  for (const r of active) byCad[r.cadence] = (byCad[r.cadence] ?? 0) + 1
  console.log('Active by cadence:', byCad)

  const noDay = active.filter(r => r.expected_day == null).length
  console.log(`Active with NO expected_day set: ${noDay} of ${active.length}\n`)

  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  console.log('Active services:')
  for (const r of active) {
    console.log(`  [${r.association_code}] ${r.vendor_name} · ${r.service_type} · cadence=${r.cadence} · bill=${r.billing_cadence} · day=${r.expected_day != null ? DAY[r.expected_day] : '—'}`)
  }

  // How many visits exist this/recent weeks (shows generator behavior).
  const { data: visits } = await sb.from('service_visits').select('week_of, recurring_service_id').order('week_of', { ascending: false }).limit(500)
  const weeks = new Map<string, number>()
  for (const v of visits ?? []) weeks.set(v.week_of as string, (weeks.get(v.week_of as string) ?? 0) + 1)
  console.log('\nVisits generated per week (recent):')
  for (const [w, n] of [...weeks.entries()].slice(0, 8)) console.log(`  ${w}: ${n} visits`)
  console.log()
}
main().catch(e => { console.error(e); process.exit(1) })
