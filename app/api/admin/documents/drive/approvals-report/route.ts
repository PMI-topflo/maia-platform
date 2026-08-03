// GET /api/admin/documents/drive/approvals-report[?assoc=MANXI&limit=120]
// Dry-run report (NO files touched): finds every SIGNED board-approval PDF for
// an association across ALL Drive folders, reads each one's TEXT (fast — no AI),
// and returns a reviewable list: unit, type (new tenant / renewal / new owner /
// add'l resident), owner (granted-to) + tenant (kept SEPARATE), lease term, and
// the approval-letter expiry (stated lease end, or — leases are one year —
// approval date + 1 year; purchases have none). Cross-checks the owner vs MAIA.
// Reads run concurrently under a time budget so it can't time out. Runs as the
// SA (impersonating PMI) — production only. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { downloadDriveFile } from '@/lib/drive-import'
import { extractPdfText } from '@/lib/extract-pdf'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Kind = 'lease' | 'renewal' | 'purchase' | 'additional'

function classify(s: string): Kind {
  const t = s.toLowerCase()
  if (/renewal|renenal|reneal/.test(t)) return 'renewal'
  if (/additional\s*(resident|occupant)|resident board approval/.test(t)) return 'additional'
  if (/new\s*owner|new\s*buyer|certificate of approval for purchase|approval for purchase/.test(t)) return 'purchase'
  return 'lease'
}
function isoFromMDY(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null
  const y = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
function plusOneYear(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null
  d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10)
}
function unitFromName(name: string): string | null {
  const m = name.match(/\b(?:unit|apt)\s*#?\s*0*(\d{3,4})\b/i) || name.match(/\b0*(\d{3,4})\b/)
  return m ? `MANXI${m[1]}` : null
}
function parseApproval(rawText: string | null, name: string) {
  const t = (rawText ?? '').replace(/\s+/g, ' ').trim()
  const kind = classify(`${name} ${t}`)
  const grant = t.match(/granted to:?\s*(?:Name\(s\):?\s*)?([A-Za-z0-9 .,'&()/\-]+?)(?:\s+Tenants?:|\s+Physical address|\s+Property Address|\s+Lessee|\s+Said approval|$)/i)
  const owner = grant ? grant[1].trim().replace(/\s{2,}/g, ' ') || null : null
  const ten = t.match(/Tenants?:\s*([A-Za-z0-9 .,'&()/\-]+?)(?:\s+Physical address|\s+Lease |\s+Said approval|\s+Property|$)/i)
  const tenant = kind === 'purchase' ? null : (ten ? ten[1].trim() : null)
  const unitM = t.match(/Apt\.?\s*#?\s*0*(\d{3,4})/i) || t.match(/unit\s*#?\s*0*(\d{3,4})/i)
  const term = t.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-|–|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  return {
    kind, owner, tenant,
    unit: (unitM ? `MANXI${unitM[1]}` : null) ?? unitFromName(name),
    leaseStart: term ? isoFromMDY(term[1]) : null,
    leaseEnd: term ? isoFromMDY(term[2]) : null,
  }
}

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const sp = new URL(req.url).searchParams
  const assoc = (sp.get('assoc') || 'MANXI').toUpperCase()
  const limit = Math.min(parseInt(sp.get('limit') || '120', 10) || 120, 200)
  const nameToken = assoc === 'MANXI' ? 'INVERRARY XI' : assoc

  const ownerByUnit = new Map<string, string>()
  { let from = 0; for (;;) {
    const { data } = await supabaseAdmin.from('owners').select('unit_number, first_name, last_name, entity_name, status').eq('association_code', assoc).range(from, from + 999)
    for (const o of data ?? []) { if ((o.status ?? '') === 'previous') continue; const u = String(o.unit_number ?? '').trim(); if (u && !ownerByUnit.has(u)) ownerByUnit.set(u, (o.entity_name || [o.first_name, o.last_name].filter(Boolean).join(' ')).trim()) }
    if (!data || data.length < 1000) break; from += 1000
  } }

  const drive = getDrive()
  const files: { id: string; name: string; createdTime: string }[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: `fullText contains '${nameToken}' and mimeType = 'application/pdf' and name contains 'Approval' and trashed = false`,
      fields: 'nextPageToken, files(id, name, createdTime)', pageSize: 100, orderBy: 'createdTime desc',
      corpora: 'user', supportsAllDrives: true, includeItemsFromAllDrives: true,
    })
    for (const f of res.data.files ?? []) if (f.id) files.push({ id: f.id, name: f.name ?? '', createdTime: f.createdTime ?? '' })
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken && files.length < limit)

  const skip = /estoppel|audit only|client representation|engagement letter/i
  const candidates = files.filter(f => !skip.test(f.name)).slice(0, limit)

  // Read + parse concurrently, bounded, under a ~250s budget.
  type Row = { fileId: string; fileName: string; unit: string | null; kind: Kind; approvalDate: string | null; owner: string | null; tenant: string | null; tenantEmail: string | null; tenantPhone: string | null; leaseStart: string | null; leaseEnd: string | null; expiry: string | null; maiaOwner: string | null; ownerMatches: boolean }
  const rows: Row[] = []
  let truncated = false
  const CONCURRENCY = 8
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    if (Date.now() - started > 250_000) { truncated = true; break }
    const slice = candidates.slice(i, i + CONCURRENCY)
    const done = await Promise.all(slice.map(async f => {
      let text: string | null = null
      try { const buf = await downloadDriveFile(f.id); text = (await extractPdfText(buf, 'application/pdf')).text } catch { /* keep null */ }
      const p = parseApproval(text, f.name)
      const expiry = p.kind === 'purchase' ? null : (p.leaseEnd || plusOneYear(p.leaseStart || f.createdTime))
      const maiaOwner = p.unit ? (ownerByUnit.get(p.unit.replace(/^MANXI/i, '')) ?? null) : null
      const ownerMatches = !!(p.owner && maiaOwner && (p.owner.toLowerCase().includes(maiaOwner.split(' ')[0]?.toLowerCase() ?? '~') || maiaOwner.toLowerCase().includes(p.owner.split(' ')[0]?.toLowerCase() ?? '~')))
      return { fileId: f.id, fileName: f.name, unit: p.unit, kind: p.kind, approvalDate: f.createdTime?.slice(0, 10) ?? null, owner: p.owner, tenant: p.tenant, tenantEmail: null, tenantPhone: null, leaseStart: p.leaseStart, leaseEnd: p.leaseEnd, expiry, maiaOwner, ownerMatches } as Row
    }))
    rows.push(...done)
  }

  rows.sort((a, b) => (a.unit ?? 'zzz').localeCompare(b.unit ?? 'zzz'))
  return NextResponse.json({ ok: true, association: assoc, scanned: files.length, reported: rows.length, truncated, rows })
}
