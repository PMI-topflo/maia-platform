// Read-only: for MAIA work-order tickets with no cinc_workorder_id, show
// their integration_outbox 'create' row state (if any) so we know whether
// they'll auto-sync on the next drain or need re-enqueueing.
//   npx tsx scripts/probe-unsynced-wo-outbox.ts
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

try {
  const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('='); if (i < 1) continue
    const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (k && !(k in process.env)) process.env[k] = v
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

async function main() {
  const { data: tickets } = await supabase
    .from('tickets')
    .select('id, ticket_number, association_code, created_at')
    .eq('type', 'work_order')
    .is('cinc_workorder_id', null)
    .not('association_code', 'is', null)
    .order('association_code')
  if (!tickets?.length) { console.log('No unsynced work orders.'); return }

  console.log(`\n${tickets.length} unsynced MAIA work order(s):\n`)
  for (const t of tickets) {
    const { data: rows } = await supabase
      .from('integration_outbox')
      .select('id, operation, status, attempts, last_error, created_at')
      .eq('target', 'cinc')
      .eq('entity_type', 'ticket')
      .eq('entity_id', t.id)
      .order('created_at', { ascending: false })
    const create = (rows ?? []).find(r => r.operation === 'create')
    const state = create
      ? `outbox: ${create.status} (attempts=${create.attempts})${create.last_error ? ` — ${String(create.last_error).slice(0, 80)}` : ''}`
      : 'NO outbox create row (never enqueued — likely created while CINC_SYNC was off)'
    console.log(`  ${String(t.association_code).padEnd(8)} ${t.ticket_number ?? t.id}  ${state}`)
  }
  console.log('')
}
main().catch(e => { console.error(e); process.exit(1) })
