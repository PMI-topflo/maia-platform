// =====================================================================
// lib/staff-task-sync.ts
//
// Generates + closes MAIA staff_tasks from live system state, idempotently
// (keyed by source_ref). Drives each person's "Your tasks coming up" in
// the Daily News. Only touches source='maia' rows — manual tasks are left
// alone.
//
// Rules (role → resolved live from pmi_staff, falling back to the known
// seat email so it follows whoever holds the role):
//   • Isabela (AP)        — one task per invoice in Pending Review;
//                           closes when she sends it to Ready to Push.
//   • Karen (Fin. Mgr)    — one task per invoice Ready to Push; closes
//                           when she pushes it to CINC.
//   • Jonathan (AR)       — a standing daily "mark approved invoices Paid
//                           in CINC"; one task per Applicable+open
//                           compliance item; closes when it goes Current.
//   • Fabio (Strategist)  — one task per "New in Maia" delivery.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { COMPLIANCE_TAXONOMY } from '@/lib/compliance-taxonomy'
import { recentWhatsNew } from '@/lib/staff-news'

const ITEM_LABEL = new Map(COMPLIANCE_TAXONOMY.flatMap(c => c.items.map(i => [i.key, i.label] as const)))
const ITEM_HAS_EXPIRY = new Map(COMPLIANCE_TAXONOMY.flatMap(c => c.items.map(i => [i.key, !!i.expiry] as const)))

// role key → { how to recognise the role in pmi_staff.role, seat email }
const ROLE_RULES: Record<string, { match: RegExp; fallback: string }> = {
  ap:          { match: /payable|\bap\b/i,                fallback: 'ap@topfloridaproperties.com' },
  financial:   { match: /financial manager|\bbilling\b/i, fallback: 'billing@topfloridaproperties.com' },
  ar:          { match: /receivable|\bar\b/i,             fallback: 'ar@topfloridaproperties.com' },
  strategist:  { match: /strateg/i,                       fallback: 'pmi@pmitop.com' },
}

interface DesiredTask { source_ref: string; assignee_email: string; title: string; recurrence: string; next_due: string | null; expiry_date: string | null }
const MANAGED_PREFIXES = ['compliance:', 'invoice_review:', 'invoice_push:', 'delivery:', 'recon_daily']
const money = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '' }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

function etToday(now: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return p // en-CA → YYYY-MM-DD
}

async function resolveRoles(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from('pmi_staff').select('email, role').eq('active', true)
  const rows = (data ?? []) as { email: string | null; role: string | null }[]
  const out: Record<string, string> = {}
  for (const [key, rule] of Object.entries(ROLE_RULES)) {
    const hit = rows.find(r => r.role && rule.match.test(r.role) && r.email)
    out[key] = (hit?.email ?? rule.fallback).toLowerCase()
  }
  return out
}

export interface SyncResult { desired: number; created: number; updated: number; closed: number }

export async function syncStaffTasks(now = new Date()): Promise<SyncResult> {
  const role = await resolveRoles()
  const desired: DesiredTask[] = []

  // ── Compliance (Jonathan / AR) ──────────────────────────────────────
  const { data: comp } = await supabaseAdmin
    .from('compliance_records')
    .select('association_code, item_key, status, expiry_date')
    .eq('scope', 'association').eq('applicable', true)
    .in('status', ['missing', 'non_compliant', 'pending'])
  for (const c of (comp ?? []) as { association_code: string; item_key: string; status: string; expiry_date: string | null }[]) {
    const label = ITEM_LABEL.get(c.item_key) ?? c.item_key
    const verb = c.status === 'missing' ? 'Upload' : c.status === 'pending' ? 'Renew' : 'Resolve'
    desired.push({
      source_ref: `compliance:${c.association_code}:${c.item_key}`,
      assignee_email: role.ar, title: `${verb} ${label} — ${c.association_code}`,
      recurrence: ITEM_HAS_EXPIRY.get(c.item_key) ? 'on_expiry' : 'once',
      next_due: c.expiry_date, expiry_date: c.expiry_date,
    })
  }

  // ── Invoices: Pending Review (Isabela) + Ready to Push (Karen) ───────
  const { data: inv } = await supabaseAdmin
    .from('invoice_intake_drafts')
    .select('id, status, extracted_vendor_name, matched_vendor_short_name, matched_vendor_name, extracted_amount, extracted_association_code')
    .in('status', ['pending_review', 'ready_to_push'])
  for (const d of (inv ?? []) as Record<string, unknown>[]) {
    const vendor = String(d.matched_vendor_short_name ?? d.matched_vendor_name ?? d.extracted_vendor_name ?? 'vendor')
    const assoc = d.extracted_association_code ? ` — ${d.extracted_association_code}` : ''
    const amt = money(d.extracted_amount)
    if (d.status === 'pending_review') {
      desired.push({ source_ref: `invoice_review:${d.id}`, assignee_email: role.ap, title: `Review invoice · ${vendor} ${amt}${assoc}`.trim(), recurrence: 'once', next_due: null, expiry_date: null })
    } else if (d.status === 'ready_to_push') {
      desired.push({ source_ref: `invoice_push:${d.id}`, assignee_email: role.financial, title: `Push invoice → CINC · ${vendor} ${amt}${assoc}`.trim(), recurrence: 'once', next_due: null, expiry_date: null })
    }
  }

  // ── Standing daily recon (Jonathan) ─────────────────────────────────
  desired.push({ source_ref: 'recon_daily', assignee_email: role.ar, title: 'Mark approved invoices Paid in CINC (To Pay in CINC)', recurrence: 'daily', next_due: etToday(now), expiry_date: null })

  // ── Fabio deliveries (last 30 days of "New in Maia") ────────────────
  for (const it of recentWhatsNew(now.toISOString(), 30)) {
    desired.push({ source_ref: `delivery:${it.date}:${slug(it.title)}`, assignee_email: role.strategist, title: `Delivered: ${it.title}`, recurrence: 'once', next_due: it.date, expiry_date: null })
  }

  // ── Reconcile against existing MAIA tasks (idempotent) ──────────────
  const { data: existing } = await supabaseAdmin
    .from('staff_tasks').select('id, source_ref, active, assignee_email, title, next_due, expiry_date')
    .eq('source', 'maia').not('source_ref', 'is', null)
  const byRef = new Map<string, { id: string; active: boolean; assignee_email: string | null; title: string | null; next_due: string | null; expiry_date: string | null }>()
  for (const r of (existing ?? []) as { id: string; source_ref: string; active: boolean; assignee_email: string | null; title: string | null; next_due: string | null; expiry_date: string | null }[]) byRef.set(r.source_ref, r)

  let created = 0, updated = 0, closed = 0
  const desiredRefs = new Set(desired.map(d => d.source_ref))

  for (const d of desired) {
    const ex = byRef.get(d.source_ref)
    if (!ex) {
      await supabaseAdmin.from('staff_tasks').insert({ assignee_email: d.assignee_email, title: d.title, source: 'maia', recurrence: d.recurrence, next_due: d.next_due, expiry_date: d.expiry_date, source_ref: d.source_ref, active: true, created_by: 'maia-sync' })
      created++
    } else if (!ex.active || ex.assignee_email !== d.assignee_email || ex.title !== d.title || ex.next_due !== d.next_due || ex.expiry_date !== d.expiry_date) {
      await supabaseAdmin.from('staff_tasks').update({ active: true, assignee_email: d.assignee_email, title: d.title, next_due: d.next_due, expiry_date: d.expiry_date }).eq('id', ex.id)
      updated++
    }
  }
  // Close managed tasks no longer desired (item went Current, invoice moved on, …)
  for (const [ref, ex] of byRef) {
    if (!ex.active) continue
    if (!MANAGED_PREFIXES.some(p => ref.startsWith(p))) continue
    if (desiredRefs.has(ref)) continue
    await supabaseAdmin.from('staff_tasks').update({ active: false }).eq('id', ex.id)
    closed++
  }

  return { desired: desired.length, created, updated, closed }
}
