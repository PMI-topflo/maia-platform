// GET /api/admin/documents/drive/approvals-report[?assoc=MANXI&limit=200]
// Dry-run report (NO files touched): finds every SIGNED board-approval PDF for
// an association across ALL Drive folders and returns a reviewable list built
// from the FILE NAME + MAIA — unit, type (new tenant / renewal / new owner /
// add'l resident), approval date, the term year if in the name, the owner on
// file, and the estimated expiry (term end, or — leases are one year — approval
// date + 1 year). Intentionally does NOT open each PDF (that timed out); the
// exact tenant, owner-verify, and lease dates come from the per-unit read
// during the move. Fast + can't crash. Runs as the SA — production only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Kind = 'lease' | 'renewal' | 'purchase' | 'additional'

function classify(s: string): Kind {
  const t = s.toLowerCase()
  if (/renewal|renenal|reneal/.test(t)) return 'renewal'
  if (/additional\s*(resident|occupant)|resident board approval/.test(t)) return 'additional'
  if (/new\s*owner|new\s*buyer|purchase/.test(t)) return 'purchase'
  return 'lease'
}
// MANXI units are 101–1015 — pull the unit while ignoring year tokens (2024–2026).
function unitFromName(name: string): string | null {
  const m = name.match(/\b(?:unit|apt)\s*#?\s*0*(\d{3,4})\b/i)
  if (m) return `MANXI${m[1]}`
  const cand = [...name.matchAll(/\b(\d{3,4})\b/g)].map(x => x[1]).find(n => { const v = +n; return v >= 101 && v <= 1099 })
  return cand ? `MANXI${cand}` : null
}
function plusOneYear(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null
  d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  try {
    if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const sp = new URL(req.url).searchParams
    const assoc = (sp.get('assoc') || 'MANXI').toUpperCase()
    const limit = Math.min(parseInt(sp.get('limit') || '200', 10) || 200, 300)
    const nameToken = assoc === 'MANXI' ? 'INVERRARY XI' : assoc

    // Owner on file per unit (MAIA), for the cross-check.
    const ownerByUnit = new Map<string, string>()
    { let from = 0; for (;;) {
      const { data } = await supabaseAdmin.from('owners').select('unit_number, first_name, last_name, entity_name, status').eq('association_code', assoc).range(from, from + 999)
      for (const o of data ?? []) { if ((o.status ?? '') === 'previous') continue; const u = String(o.unit_number ?? '').trim(); if (u && !ownerByUnit.has(u)) ownerByUnit.set(u, (o.entity_name || [o.first_name, o.last_name].filter(Boolean).join(' ')).trim()) }
      if (!data || data.length < 1000) break; from += 1000
    } }

    const drive = getDrive()
    const files: { id: string; name: string; createdTime: string; webViewLink: string | null }[] = []
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: `fullText contains '${nameToken}' and mimeType = 'application/pdf' and name contains 'Approval' and trashed = false`,
        fields: 'nextPageToken, files(id, name, createdTime, webViewLink)', pageSize: 100, orderBy: 'createdTime desc',
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files ?? []) if (f.id) files.push({ id: f.id, name: f.name ?? '', createdTime: f.createdTime ?? '', webViewLink: f.webViewLink ?? null })
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken && files.length < limit)

    const skip = /estoppel|audit only|client representation|engagement letter/i
    const rows = files.filter(f => !skip.test(f.name)).slice(0, limit).map(f => {
      const kind = classify(f.name)
      const unit = unitFromName(f.name)
      // Term year in the name (e.g. "2025_2026") → end-year for a rough expiry.
      const term = f.name.match(/\b(20\d{2})[_\-](20\d{2})\b/)
      const leaseEnd = term ? `${term[2]}-06-30` : null   // rough; exact date from the PDF at move time
      const approvalDate = f.createdTime ? f.createdTime.slice(0, 10) : null
      const expiry = kind === 'purchase' ? null : (leaseEnd || plusOneYear(approvalDate))
      return {
        fileId: f.id, fileName: f.name, driveUrl: f.webViewLink, unit, kind, approvalDate,
        maiaOwner: unit ? (ownerByUnit.get(unit.replace(/^MANXI/i, '')) ?? null) : null,
        termInName: term ? `${term[1]}–${term[2]}` : null, expiry,
      }
    }).sort((a, b) => (a.unit ?? 'zzz').localeCompare(b.unit ?? 'zzz'))

    return NextResponse.json({ ok: true, association: assoc, scanned: files.length, reported: rows.length, rows })
  } catch (e) {
    return NextResponse.json({ error: `Report error: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
