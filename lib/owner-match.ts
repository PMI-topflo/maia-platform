// =====================================================================
// lib/owner-match.ts
// Resolve a unit-level document to an owner/unit. MAIA reads identifiers off
// the document (owner name, unit/apt number, property address, account #); we
// match that to the `owners` table. When the association wasn't detected, we
// search ALL owners and let the matched owner's record supply the association
// AND the unit — so an HO-6 or lease with just a unit number + name still files
// to the right unit. Returns null when there's no confident match (staff pick
// manually). The unit number is a strong key within an association.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'

export interface OwnerResolution { account_number: string; association_code: string; label: string }
interface OwnerRow { account_number: string; association_code: string; first_name: string | null; last_name: string | null; unit_number: string | null; address: string | null; street_number: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function ownerLabel(o: { first_name?: string | null; last_name?: string | null; unit_number?: string | null; account_number: string }): string {
  const name = [o.first_name, o.last_name].filter(Boolean).join(' ').trim()
  const unit = o.unit_number ? ` · Unit ${o.unit_number}` : ''
  return `${name || 'Owner'}${unit} (${o.account_number})`
}

/** Resolve the owner/unit a document belongs to. `assocCode` scopes the search
 *  when MAIA detected the association; otherwise we search every owner and the
 *  match supplies the association too. `seen` is the free-text identifier MAIA
 *  read (owner/insured/landlord name, unit #, property address, account #). */
export async function resolveOwnerForDocument(assocCode: string | null, seen: string | null): Promise<OwnerResolution | null> {
  if (!seen || !seen.trim()) return null
  let q = supabaseAdmin.from('owners')
    .select('account_number, association_code, first_name, last_name, unit_number, address, street_number')
    .or('status.neq.previous,status.is.null')
  if (assocCode) q = q.eq('association_code', assocCode)
  const { data } = await q
  const owners = (data ?? []) as OwnerRow[]
  if (owners.length === 0) return null

  const seenN  = ' ' + norm(seen) + ' '
  const tokens = new Set(seenN.trim().split(' ').filter(Boolean))
  const digits: string[] = seen.match(/\d{3,}/g) ?? []
  const scoped = !!assocCode

  // 1) Exact account number printed on the document — unambiguous.
  for (const o of owners) {
    if (o.account_number && digits.includes(String(o.account_number))) {
      return { account_number: String(o.account_number), association_code: String(o.association_code), label: ownerLabel(o) }
    }
  }

  // 2) Score by owner name + unit number + property address.
  let best: OwnerRow | null = null, bestScore = 0, secondScore = 0
  for (const o of owners) {
    let s = 0
    const fn = norm(o.first_name ?? ''), ln = norm(o.last_name ?? '')
    if (ln && seenN.includes(` ${ln} `)) s += 2
    if (fn && seenN.includes(` ${fn} `)) s += 1
    if (fn && ln && seenN.includes(` ${fn} ${ln} `)) s += 1                 // full name adjacency
    const unit = norm(String(o.unit_number ?? ''))
    if (unit && tokens.has(unit)) s += scoped ? 3 : 2                       // unit # is near-unique per assoc
    const sn = String(o.street_number ?? '').trim()
    const addrWords = norm(o.address ?? '').split(' ').filter(t => t.length > 2)
    const addrHit = addrWords.some(t => tokens.has(t))
    if (sn && tokens.has(sn) && addrHit) s += 3                             // street number + a street word
    else if (addrHit) s += 1
    if (s > bestScore) { secondScore = bestScore; bestScore = s; best = o }
    else if (s > secondScore) secondScore = s
  }

  // Require a strong, reasonably unambiguous match.
  if (best && bestScore >= 3 && bestScore > secondScore) {
    return { account_number: String(best.account_number), association_code: String(best.association_code), label: ownerLabel(best) }
  }
  return null
}
