// GET /api/admin/documents/drive/approvals-report[?assoc=MANXI&limit=120]
// Dry-run report (NO files touched): finds every SIGNED board-approval PDF for
// an association across ALL Drive folders, reads each one, and returns a
// reviewable list — unit, type (new tenant / renewal / new owner / add'l
// resident), owner + tenant (+ email/phone if present), lease term, and the
// approval-letter expiry. Expiry = the stated lease end, or (all leases are one
// year) the approval date + 1 year. Cross-checks the owner against MAIA.
// Runs as the SA (impersonating PMI) — production only. Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { downloadDriveFile } from '@/lib/drive-import'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Kind = 'lease' | 'renewal' | 'purchase' | 'additional'

function classify(name: string): Kind {
  const s = name.toLowerCase()
  if (/renewal|renenal|reneal/.test(s)) return 'renewal'
  if (/additional\s*(resident|occupant)|add'?l|resident board/.test(s)) return 'additional'
  if (/new\s*owner|new\s*buyer|purchase/.test(s)) return 'purchase'
  return 'lease'   // "new tenant" / "approval for lease" / default
}
function unitFrom(name: string, text: string): string | null {
  const m = name.match(/\b(?:unit|apt)\s*#?\s*0*(\d{3,4})\b/i)
    || name.match(/\b0*(\d{3,4})\b/)
    || text.match(/\bapt\.?\s*0*(\d{3,4})\b/i)
  return m ? `MANXI${m[1]}` : null
}
function plusOneYear(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null
  d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const assoc = (sp.get('assoc') || 'MANXI').toUpperCase()
  const limit = Math.min(parseInt(sp.get('limit') || '120', 10) || 120, 200)
  const nameToken = assoc === 'MANXI' ? 'INVERRARY XI' : assoc

  // Owners on file (unit# → name) for the MAIA cross-check.
  const ownerByUnit = new Map<string, string>()
  { let from = 0; for (;;) {
    const { data } = await supabaseAdmin.from('owners').select('unit_number, first_name, last_name, entity_name, status').eq('association_code', assoc).range(from, from + 999)
    for (const o of data ?? []) { if ((o.status ?? '') === 'previous') continue; const u = String(o.unit_number ?? '').trim(); if (u && !ownerByUnit.has(u)) ownerByUnit.set(u, (o.entity_name || [o.first_name, o.last_name].filter(Boolean).join(' ')).trim()) }
    if (!data || data.length < 1000) break; from += 1000
  } }

  const drive = getDrive()
  // Signed approvals = PDFs (DocuSign/SignNow exports); drafts are Google Docs.
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

  // Skip obvious non-approvals (estoppels, vendor/audit engagements, client-rep).
  const skip = /estoppel|audit only|client representation|engagement letter/i
  const candidates = files.filter(f => !skip.test(f.name)).slice(0, limit)

  const rows = []
  for (const f of candidates) {
    const kind = classify(f.name)
    let owner: string | null = null, tenant: string | null = null, leaseStart: string | null = null, leaseEnd: string | null = null, email: string | null = null, phone: string | null = null, unit: string | null = unitFrom(f.name, '')
    try {
      const buf = await downloadDriveFile(f.id)
      const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
      const d = await extractLeaseDetails(buf, isPdf ? 'application/pdf' : 'image/jpeg')
      owner = d.ownerNames[0] ?? null
      tenant = d.tenantNames.join(', ') || null
      leaseStart = d.leaseStart; leaseEnd = d.leaseEnd; email = d.tenantEmail; phone = d.tenantPhone
      if (!unit) unit = unitFrom('', `${owner ?? ''} ${tenant ?? ''}`)   // best-effort
    } catch { /* keep filename-derived fields */ }

    const expiry = kind === 'purchase' ? null : (leaseEnd || plusOneYear(leaseStart || f.createdTime))
    const maiaOwner = unit ? (ownerByUnit.get(unit.replace(/^MANXI/i, '')) ?? null) : null
    rows.push({
      fileId: f.id, fileName: f.name, unit, kind, approvalDate: f.createdTime?.slice(0, 10) ?? null,
      owner, tenant, tenantEmail: email, tenantPhone: phone, leaseStart, leaseEnd, expiry,
      maiaOwner, ownerMatches: !!(owner && maiaOwner && owner.toLowerCase().includes(maiaOwner.split(' ')[0]?.toLowerCase() ?? '~')),
    })
  }

  rows.sort((a, b) => (a.unit ?? 'zzz').localeCompare(b.unit ?? 'zzz'))
  return NextResponse.json({ ok: true, association: assoc, scanned: files.length, reported: rows.length, rows })
}
