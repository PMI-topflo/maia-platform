// =====================================================================
// lib/owner-match.ts
// Match a free-text owner/unit identifier (what MAIA read off a unit-level
// document — account #, owner name, unit #) to an owner within a known
// association. Used by the Compliance Hub document intake to pre-select the
// unit a document files against. Returns null when there's no confident
// match — staff then pick the owner manually.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface OwnerRef { account_number: string; label: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function ownerLabel(o: { first_name?: string | null; last_name?: string | null; unit_number?: string | null; account_number: string }): string {
  const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
  const unit = o.unit_number ? ` · Unit ${o.unit_number}` : ''
  return `${name || 'Owner'}${unit} (${o.account_number})`
}

export async function matchOwnerInAssociation(assocCode: string, seen: string | null): Promise<OwnerRef | null> {
  if (!seen || !seen.trim()) return null
  const { data } = await supabaseAdmin.from('owners')
    .select('account_number, first_name, last_name, unit_number')
    .eq('association_code', assocCode)
    .or('status.neq.previous,status.is.null')
  const owners = (data ?? []) as { account_number: string; first_name: string | null; last_name: string | null; unit_number: string | null }[]
  if (owners.length === 0) return null

  const seenN  = ' ' + norm(seen) + ' '
  const digits: string[] = seen.match(/\d{3,}/g) ?? []

  // 1) exact account number on the document — strongest signal.
  for (const o of owners) {
    if (o.account_number && digits.includes(String(o.account_number))) return { account_number: String(o.account_number), label: ownerLabel(o) }
  }

  // 2) name (+ unit) tokens. Require the last name plus one more signal
  //    (first name or unit #) to avoid false matches on a common surname.
  let best: typeof owners[number] | null = null
  let bestScore = 0
  for (const o of owners) {
    const fn = norm(o.first_name ?? ''), ln = norm(o.last_name ?? '')
    let score = 0
    if (ln && seenN.includes(` ${ln} `)) score += 2
    if (fn && seenN.includes(` ${fn} `)) score += 1
    if (o.unit_number && seenN.includes(` ${norm(String(o.unit_number))} `)) score += 2
    if (score > bestScore) { bestScore = score; best = o }
  }
  if (best && bestScore >= 3) return { account_number: String(best.account_number), label: ownerLabel(best) }
  return null
}
