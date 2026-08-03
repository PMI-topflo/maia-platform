// POST /api/admin/documents/drive/organize/approval-move   { rows, dryRun }
// The per-unit "move" for the signed board approvals. For each CURRENT approval
// row (from the approvals report — superseded/older ones are NOT sent here):
//   1. open the approval PDF and extract tenant name(s) + email + phone + the
//      lease term (owner and tenant kept separate — never swapped);
//   2. update the unit's tenant record (unit_tenant_contacts) for leases/
//      renewals (purchases don't write a tenant record);
//   3. file unit.approval_letter (drive link + expiry = lease end, or — leases
//      are one year — approval date + 1 year; purchases carry no expiry);
//   4. copy the file, renamed "YYYY_MM_<Type> Board Approval", into the unit's
//      Official folder under Lease Applications / Purchase Applications.
// dryRun=true does steps 1 only and reports what WOULD be written/copied —
// nothing in the DB or Drive changes. Processed in small batches by the client
// (each row = one PDF download + one model call). Staff-only; runs as the SA.

import { NextResponse } from 'next/server'
import { requireStaffSession } from '@/lib/staff-auth'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { downloadDriveFile } from '@/lib/drive-import'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { DRIVE_FOLDERS, resolveUnitFolder, resolveDatedSubfolder, approvalCategoryFolder, stripNoFilesTag } from '@/lib/drive-organize-folders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface Row { fileId: string; unit: string; kind: string; driveUrl?: string | null; approvalDate?: string | null; expiry?: string | null }

const KIND_LABEL: Record<string, string> = { lease: 'New Tenant', renewal: 'Renewal', purchase: 'New Owner', additional: 'Additional Resident' }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
function plusOneYear(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null
  d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10)
}
function statusFromExpiry(exp: string | null): string {
  if (!exp) return 'current'
  const d = new Date(exp), now = new Date()
  if (d < now) return 'expiring'
  return (d.getTime() - now.getTime()) / 86_400_000 <= 45 ? 'expiring' : 'current'
}
// "2025_06_Renewal Board Approval.pdf" — safe Drive filename, YYYY_MM prefix.
function proposeName(kind: string, approvalDate: string | null | undefined): string {
  const d = approvalDate ? new Date(approvalDate) : null
  const ym = d && !Number.isNaN(d.getTime()) ? `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}_` : ''
  return `${ym}${KIND_LABEL[kind] ?? 'Board'} Board Approval.pdf`
}

export async function POST(req: Request) {
  const session = await requireStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { rows?: Row[]; dryRun?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 12) : []
  const dryRun = body.dryRun !== false   // default to dry-run — writing is opt-in
  if (rows.length === 0) return NextResponse.json({ error: 'no rows' }, { status: 400 })

  const drive = getDrive()
  const results: Record<string, unknown>[] = []

  for (const row of rows) {
    const unit = String(row.unit || '').trim()
    const kind = String(row.kind || 'lease')
    const res: Record<string, unknown> = { fileId: row.fileId, unit, kind }
    if (!unit) { res.error = 'no unit'; results.push(res); continue }
    try {
      const buf = await downloadDriveFile(row.fileId)
      const details = await extractLeaseDetails(buf, 'application/pdf')

      // Owner on file (for the swap-guard) — never write the owner's name as the tenant.
      const { data: owner } = await supabaseAdmin.from('owners')
        .select('first_name, last_name, entity_name').eq('association_code', 'MANXI').eq('account_number', unit)
        .or('status.neq.previous,status.is.null').maybeSingle()
      const ownerName = ((owner?.entity_name as string | null) || [owner?.first_name, owner?.last_name].filter(Boolean).join(' ')).trim()
      const tenants = (details.tenantNames || []).filter(t => !(ownerName && norm(t) === norm(ownerName)))
      const swapFlag = ownerName && (details.tenantNames || []).some(t => norm(t) === norm(ownerName))
      const tenantName = tenants.join(', ') || null
      const leaseEnd = details.leaseEnd || (kind === 'purchase' ? null : row.expiry || plusOneYear(row.approvalDate))
      const leaseStart = details.leaseStart || null
      const expiry = kind === 'purchase' ? null : leaseEnd

      Object.assign(res, {
        tenant: tenantName, tenantEmail: details.tenantEmail, tenantPhone: details.tenantPhone,
        leaseStart, leaseEnd, expiry, owner: ownerName || null,
        targetName: proposeName(kind, row.approvalDate),
        targetFolder: `${unit} / ${approvalCategoryFolder(kind)}`,
        ...(swapFlag ? { warning: 'a tenant name matched the owner — dropped (possible swap)' } : {}),
      })

      if (dryRun) { res.dryRun = true; results.push(res); continue }

      // 2. tenant record + mark the unit LEASED (leases/renewals/additional —
      //    not purchases). The occupancy flag is what the audit counts as
      //    "Leased" and what makes the unit page show its tenancy section.
      if (kind !== 'purchase') {
        if (tenantName || leaseStart || leaseEnd || details.tenantEmail || details.tenantPhone) {
          await supabaseAdmin.from('unit_tenant_contacts').upsert({
            association_code: 'MANXI', unit_ref: unit,
            tenant_name: tenantName, lease_start: leaseStart, lease_end: leaseEnd,
            ...(details.tenantEmail ? { tenant_email: details.tenantEmail } : {}),
            ...(details.tenantPhone ? { tenant_phone: details.tenantPhone } : {}),
            updated_by: `staff:${session.displayName} (approval move)`, updated_at: new Date().toISOString(),
          }, { onConflict: 'association_code,unit_ref' })
        }
        await supabaseAdmin.from('unit_occupancy').upsert({
          association_code: 'MANXI', unit_ref: unit, status: 'leased',
          updated_by: `staff:${session.displayName} (approval move)`, updated_at: new Date().toISOString(),
        }, { onConflict: 'association_code,unit_ref' })
      }

      // 3. file unit.approval_letter (link + expiry)
      await supabaseAdmin.from('compliance_records').upsert({
        scope: 'unit', association_code: 'MANXI', unit_ref: unit, item_key: 'unit.approval_letter',
        applicable: true, status: statusFromExpiry(expiry), expiry_date: expiry,
        ...(row.driveUrl ? { drive_url: row.driveUrl } : {}),
        updated_by: `staff:${session.displayName} (approval move)`,
      }, { onConflict: 'scope,association_code,unit_ref,item_key' })

      // 4. copy the renamed file into Official / MANXI### / <category>
      const unitFolderId = await resolveUnitFolder(DRIVE_FOLDERS.official, unit, true)
      let copiedTo: string | null = null
      if (unitFolderId) {
        // A freshly (re)created unit folder may carry the NO FILES YET tag — strip it now a file is landing.
        try {
          const meta = await drive.files.get({ fileId: unitFolderId, fields: 'name', supportsAllDrives: true })
          const clean = stripNoFilesTag(meta.data.name ?? '')
          if (clean && clean !== meta.data.name) await drive.files.update({ fileId: unitFolderId, requestBody: { name: clean }, supportsAllDrives: true })
        } catch { /* non-fatal */ }
        const catId = await resolveDatedSubfolder(unitFolderId, approvalCategoryFolder(kind), true)
        if (catId) {
          const copy = await drive.files.copy({ fileId: row.fileId, requestBody: { name: proposeName(kind, row.approvalDate), parents: [catId] }, fields: 'id, webViewLink', supportsAllDrives: true })
          copiedTo = copy.data.webViewLink ?? copy.data.id ?? null
        }
      }
      res.copiedTo = copiedTo
      res.wrote = true
      results.push(res)
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e)
      results.push(res)
    }
  }

  return NextResponse.json({ ok: true, dryRun, processed: results.length, results })
}
