// =====================================================================
// lib/vendor-dedupe.ts
//
// Before onboarding (creating) a new vendor in CINC, search the EXISTING
// CINC vendor list across a wide spectrum — legal name, DBA, check name,
// email, phone, and address — and surface likely matches so staff don't
// create a duplicate. Returns ranked candidates with the reasons each
// matched. Powered by the cached listVendorsFull() (no per-vendor calls).
// =====================================================================

import { listVendorsFull } from '@/lib/integrations/cinc'

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '')
const norm   = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Drop legal-suffix / filler noise so "ABC Plumbing LLC" ≈ "ABC Plumbing, Inc.".
const NOISE = /\b(llc|inc|incorporated|corp|corporation|co|ltd|company|pllc|pa|pc|lp|llp|the|and|of|services|service|group|enterprises)\b/g
const normName = (s?: string | null) => (s ?? '').toLowerCase().replace(NOISE, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens   = (s: string) => new Set(s.split(' ').filter(w => w.length >= 2))
function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

export interface DedupeInput {
  name?:     string | null
  dba?:      string | null
  email?:    string | null
  phone?:    string | null
  address1?: string | null
  city?:     string | null
  zip?:      string | null
}

export interface VendorMatch {
  vendorId: number
  name:     string
  dba:      string | null
  email:    string | null
  phone:    string | null
  address:  string | null
  score:    number       // 0–100 confidence
  reasons:  string[]     // 'name' | 'name~' | 'email' | 'phone' | 'address'
}

/** Free-text search across ALL CINC vendors (name / DBA / check name / email /
 *  phone / address) so staff can find an existing vendor BEFORE creating a
 *  duplicate. Looser than findVendorDuplicates — any field substring matches,
 *  exact/prefix name matches rank highest. */
export async function searchVendors(query: string, limit = 25): Promise<VendorMatch[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const vendors = await listVendorsFull().catch(() => [])
  const qNorm = norm(q), qName = normName(q), qDigits = digits(q)
  const out: VendorMatch[] = []
  for (const v of vendors) {
    const names = [v.VendorName, v.Dba, v.CheckName].filter(Boolean) as string[]
    let score = 0
    for (const n of names) {
      const nn = normName(n)
      if (!nn) continue
      if (nn === qName) score = Math.max(score, 100)
      else if (qName && (nn.startsWith(qName) || nn.includes(qName))) score = Math.max(score, 85)
      else if (qName && jaccard(nn, qName) >= 0.5) score = Math.max(score, 65)
    }
    if (norm(v.Email) && qNorm.includes('@') && norm(v.Email).includes(qNorm)) score = Math.max(score, 90)
    if (qDigits.length >= 7 && digits(v.Phone1).includes(qDigits)) score = Math.max(score, 88)
    if (qNorm.length >= 4 && norm(v.Address1).includes(qNorm)) score = Math.max(score, 60)
    if (score > 0) {
      out.push({
        vendorId: v.VendorId, name: v.VendorName, dba: v.Dba ?? null, email: v.Email ?? null,
        phone: v.Phone1 ?? null, address: [v.Address1, v.City, v.State].filter(Boolean).join(', ') || null,
        score, reasons: [],
      })
    }
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit)
}

/** Ranked likely-duplicate vendors for the given new-vendor basics. */
export async function findVendorDuplicates(input: DedupeInput): Promise<VendorMatch[]> {
  const vendors = await listVendorsFull().catch(() => [])
  const inNames = [normName(input.name), normName(input.dba)].filter(Boolean)
  const inEmail = norm(input.email)
  const inPhone = digits(input.phone)
  const inAddr  = norm(input.address1)
  const inZip   = digits(input.zip)

  const out: VendorMatch[] = []
  for (const v of vendors) {
    const reasons: string[] = []
    let score = 0
    const vNames = [normName(v.VendorName), normName(v.Dba), normName(v.CheckName)].filter(Boolean)

    for (const a of inNames) for (const b of vNames) {
      if (!a || !b) continue
      if (a === b) { score = Math.max(score, 100); if (!reasons.includes('name')) reasons.push('name') }
      else if (a.length >= 4 && (a.includes(b) || b.includes(a))) { score = Math.max(score, 78); if (!reasons.includes('name~')) reasons.push('name~') }
      else if (jaccard(a, b) >= 0.6) { score = Math.max(score, 70); if (!reasons.includes('name~')) reasons.push('name~') }
    }
    if (inEmail && norm(v.Email) === inEmail) { score = Math.max(score, 96); reasons.push('email') }
    if (inPhone.length >= 10 && digits(v.Phone1).slice(-10) === inPhone.slice(-10)) { score = Math.max(score, 92); reasons.push('phone') }
    if (inAddr.length >= 5 && norm(v.Address1) && (norm(v.Address1).includes(inAddr) || inAddr.includes(norm(v.Address1)))) {
      reasons.push('address'); score = Math.max(score, inZip && digits(v.ZipCode) === inZip ? 82 : 62)
    }

    if (reasons.length && score >= 60) {
      out.push({
        vendorId: v.VendorId,
        name:     v.VendorName,
        dba:      v.Dba ?? null,
        email:    v.Email ?? null,
        phone:    v.Phone1 ?? null,
        address:  [v.Address1, v.City, v.State].filter(Boolean).join(', ') || null,
        score, reasons,
      })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8)
}
