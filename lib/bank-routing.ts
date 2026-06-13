// =====================================================================
// lib/bank-routing.ts
// ABA routing-number helpers for the vendor ACH confirm/entry flow.
//   • isValidRoutingNumber() — 9 digits + the ABA checksum.
//   • lookupBankName()       — resolve the institution name from the routing
//     number via the free routingnumbers.info directory, cached in-process.
//     Best-effort: returns null (caller shows "routing only") if the lookup
//     is unavailable — never throws, never blocks the flow.
// The routing number is the public number on the bottom of a check, so it is
// safe to display in full; we never expose the account number here.
// =====================================================================

/** True iff `rn` is 9 digits and passes the ABA mod-10 checksum. */
export function isValidRoutingNumber(rn: string): boolean {
  const d = (rn ?? '').replace(/\D/g, '')
  if (d.length !== 9) return false
  const n = d.split('').map(Number)
  const sum =
    3 * (n[0] + n[3] + n[6]) +
    7 * (n[1] + n[4] + n[7]) +
    1 * (n[2] + n[5] + n[8])
  return sum % 10 === 0
}

const _cache = new Map<string, string | null>()

/** Resolve the bank/institution name for an ABA routing number. Cached;
 *  returns null on any failure (invalid number, network, not found). */
export async function lookupBankName(routing: string): Promise<string | null> {
  const rn = (routing ?? '').replace(/\D/g, '')
  if (!isValidRoutingNumber(rn)) return null
  if (_cache.has(rn)) return _cache.get(rn) ?? null

  let name: string | null = null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`https://www.routingnumbers.info/api/name.json?rn=${rn}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    }).finally(() => clearTimeout(timer))
    if (res.ok) {
      const j = await res.json().catch(() => null) as { code?: number; name?: string } | null
      // code 200 = found; the directory upper-cases names — title-case for display.
      if (j && j.code === 200 && typeof j.name === 'string' && j.name.trim()) {
        name = titleCase(j.name.trim())
      }
    }
  } catch { /* network/timeout — fall through to null */ }

  _cache.set(rn, name)
  return name
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
    // keep common all-caps tokens uppercased
    .replace(/\b(Na|Usa|Fsb|Ssb|Fcu|Cu|Bofa)\b/gi, m => m.toUpperCase())
}
