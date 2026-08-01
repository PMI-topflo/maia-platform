// POST /api/admin/documents/drive/organize/read  { fileId, folderName? }
// Have MAIA READ a Drive file's contents (not just its filename) and report
// what it is + the key dates. Recognizes files whose names give nothing away
// (e.g. a Lauderhill Certificate of Use saved as "20260511_174741.jpg") and
// pulls the expiration date. Backs the "Read with MAIA" button on the organize
// screen. Read-only — files nothing; the client decides whether to save.
// Staff-only.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { downloadDriveFile } from '@/lib/drive-import'
import { classifyDocument, type AssociationRef, type DetectedItem } from '@/lib/document-classifier'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { analyzeInsurance } from '@/lib/insurance-analysis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

// Two person names share 2+ meaningful tokens → likely the same person
// (catches "John Bassie" ↔ "Bassie, John A"). Entities compared the same way.
function namesOverlap(a: string, b: string): boolean {
  const toks = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  const ta = new Set(toks(a)); const common = toks(b).filter(w => ta.has(w))
  return common.length >= 2
}

// "Unit 910" / "MANXI910 - 4174 Inverrary Drive" → MANXI910. This cleanup is
// Manors XI, so a bare "Unit ###" folder maps to the MANXI account.
function unitFromFolder(name: string | null): string | null {
  const m = String(name ?? '').match(/MANXI\s*0*(\d+)/i) || String(name ?? '').match(/\bunit\s*0*(\d+)/i)
  return m ? `MANXI${m[1]}` : null
}

export async function POST(req: Request) {
  if (!await requireStaffSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fileId?: string; folderName?: string; fileName?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const fileId = String(body.fileId ?? '').trim()
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 })

  const { data: assocRows } = await supabaseAdmin.from('associations')
    .select('association_code, association_name, principal_address, city, state, zip, match_aliases').order('association_name')
  const assocs: AssociationRef[] = (assocRows ?? []).map(a => ({
    code: String(a.association_code), name: String(a.association_name ?? a.association_code),
    address: a.principal_address as string | null, city: a.city as string | null, state: a.state as string | null, zip: a.zip as string | null,
    aliases: (a.match_aliases as string[] | null) ?? undefined,
  }))

  try {
    const buf = await downloadDriveFile(fileId)   // Google-native → exported PDF
    const mime = sniffMime(buf)
    const cls = await classifyDocument(buf, mime, assocs, 1, body.folderName ?? null)

    // Prefer a unit-scope item with a date; fall back to the most confident.
    const items = cls.items ?? []
    const best: DetectedItem | null =
      items.filter(i => i.scope === 'unit').sort((a, b) => b.confidence - a.confidence)[0]
      ?? items.sort((a, b) => b.confidence - a.confidence)[0]
      ?? null

    // When it's a lease OR a tenant/landlord affidavit, pull the tenant + lease
    // details (for the unit's tenant record — tenant side only). Best-effort.
    const idHay = `${best?.item_key ?? ''} ${best?.category ?? ''} ${best?.doc_type ?? ''} ${body.fileName ?? ''}`.toLowerCase()
    const isTenantDoc = /leasing|lease|rental agreement|tenanc|affidavit/.test(idHay)
    const lease = isTenantDoc ? await extractLeaseDetails(buf, mime).catch(() => null) : null

    // Swap guard: if an extracted "tenant" name actually matches the unit's
    // CINC OWNER, warn before it's saved as a tenant (a common data-entry mix-up).
    const resolvedUnit = unitFromFolder(body.folderName ?? null) ?? (best?.unit_seen ?? null)
    let tenantOwnerMatch: string | null = null
    if (lease?.tenantNames.length && resolvedUnit) {
      const { data: owners } = await supabaseAdmin.from('owners')
        .select('first_name, last_name, entity_name')
        .eq('association_code', cls.association_code ?? 'MANXI').eq('account_number', resolvedUnit)
        .or('status.neq.previous,status.is.null')
      const ownerNames = (owners ?? []).map(o => o.entity_name || [o.first_name, o.last_name].filter(Boolean).join(' ')).filter(Boolean) as string[]
      for (const tn of lease.tenantNames) {
        const hit = ownerNames.find(on => namesOverlap(tn, on))
        if (hit) { tenantOwnerMatch = hit; break }
      }
    }

    // When it looks like a UNIT insurance policy, read it by its actual
    // coverages — so a liability-only binder isn't accepted as an HO-6.
    const hay = `${best?.item_key ?? ''} ${best?.category ?? ''} ${best?.doc_type ?? ''}`.toLowerCase()
    const isInsurance = /insurance|\bho-?6\b|\bho-?4\b|\bho-?3\b|policy|binder|liability|coverage/.test(hay)
    const insurance = isInsurance ? await analyzeInsurance(buf, mime).catch(() => null) : null

    // Lauderhill Certificate of Use isn't a taxonomy item — the classifier used
    // to shoehorn it into unit.occupancy. File it under its own unit item so it
    // satisfies the MANXI custom requirement + tracks its own expiry.
    const isLauderhillCert = /certificate of use|lauderhill|cert.*use|\bcou\b/.test(hay)
    const itemKey = isLauderhillCert ? 'unit.lauderhill_cou' : (best?.item_key ?? null)
    const scope = isLauderhillCert ? 'unit' : (best?.scope ?? 'unit')

    return NextResponse.json({
      ok: true,
      associationCode: cls.association_code ?? 'MANXI',
      unitRef: resolvedUnit,
      summary: cls.summary,
      detected: best ? {
        scope, category: best.category, itemKey,
        docType: best.doc_type, effectiveDate: best.effective_date, expirationDate: best.expiration_date,
        confidence: best.confidence,
      } : null,
      lease: lease && (lease.tenantNames.length || lease.leaseStart || lease.leaseEnd) ? lease : null,
      tenantOwnerMatch,
      insurance,
      allItems: items.map(i => ({ itemKey: i.item_key, docType: i.doc_type, scope: i.scope, expirationDate: i.expiration_date })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: `MAIA could not read this file: ${e instanceof Error ? e.message : String(e)}` }, { status: 200 })
  }
}
