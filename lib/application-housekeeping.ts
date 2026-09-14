// =====================================================================
// lib/application-housekeeping.ts
//
// MAIA × Drive housekeeping for one association's applications: which
// open applications look dead (lease long over, idle for weeks, nothing
// uploaded), which On Going Drive folders are duplicates, orphans (no open
// application behind them) or missing, so staff can expire, merge, archive
// or create with one click. User direction, 2026-09-14 ("let's fix MAIA
// and Drive"; Tenant Evaluation is being retired). Read-only here; the
// actions live in the API route.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDrive } from '@/lib/drive-invoice-mirror'
import { resolveAssocDriveFolders } from '@/lib/drive-organize-folders'
import { unitRefFromFolder } from '@/lib/drive-ongoing'
import { getApplicationDashboard } from '@/lib/application-dashboard'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const OPEN = ['started', 'submitted', 'under_review', 'approval_sent']

export interface HousekeepingApp {
  id: string; unitLabel: string | null; unitRef: string; type: string; status: string; applicants: string[]
  createdAt: string; lastActivityAt: string | null; idleDays: number; documents: number
  stage: string; stageLabel: string
  leaseEndOnFile: string | null; leaseEndedDaysAgo: number | null
  driveFolderId: string | null; driveFolderUrl: string | null; driveFolderPresent: boolean
  flags: string[]            // human-readable reasons this row needs attention
  suggestExpire: boolean
  notice: { kind: string; dueAt: string } | null   // open automatic-expiry notice
}
export interface HousekeepingFolder { id: string; name: string; unitRef: string | null; fileCount: number; createdAt: string | null; url: string; openApplicationIds: string[] }
export interface Housekeeping {
  associationCode: string
  generatedAt: string
  apps: HousekeepingApp[]
  folders: { ok: boolean; error: string | null; ongoingRootUrl: string | null; duplicates: { unitRef: string; folders: HousekeepingFolder[] }[]; orphans: HousekeepingFolder[]; unparsed: HousekeepingFolder[] }
  missingFolders: HousekeepingApp[]
  recentlyClosed: { id: string; unitLabel: string | null; status: string; at: string | null; reason: string | null }[]
}

const days = (from: string, to = Date.now()) => Math.floor((to - new Date(from).getTime()) / 86_400_000)

export async function buildHousekeeping(associationCode: string): Promise<Housekeeping> {
  const code = associationCode.toUpperCase()
  const now = new Date().toISOString()
  const [{ data: apps }, dash, { data: closedRows }] = await Promise.all([
    supabaseAdmin.from('listing_applications')
      .select('id, unit_label, application_type, status, created_at, updated_at, drive_folder_id, drive_folder_url, expiry_notice_kind, expiry_due_at')
      .eq('association_code', code).in('status', OPEN).order('unit_label'),
    getApplicationDashboard({ associationCode: code }).catch(() => null),
    supabaseAdmin.from('listing_applications').select('id, unit_label, status, withdrawn_at, withdrawn_reason')
      .eq('association_code', code).in('status', ['withdrawn', 'expired']).order('withdrawn_at', { ascending: false }).limit(20),
  ])
  const dashById = new Map<string, { stage: string; stageLabel?: string }>()
  for (const r of (dash?.rows ?? []) as unknown as { applicationId?: string; id?: string; stage: string; stageLabel?: string }[]) dashById.set(String(r.applicationId ?? r.id), r)

  const rows: HousekeepingApp[] = []
  for (const a of apps ?? []) {
    const id = String(a.id)
    const unit = (a.unit_label as string | null) ?? null
    const unitRef = `${code}${String(unit ?? '').replace(/\D/g, '')}`
    const [{ data: stk }, { data: docs }, { data: rev }, { data: tc }] = await Promise.all([
      supabaseAdmin.from('application_stakeholders').select('name').eq('application_id', id).eq('role', 'applicant'),
      supabaseAdmin.from('application_documents').select('created_at').eq('application_id', id).order('created_at', { ascending: false }),
      supabaseAdmin.from('application_document_reviews').select('decided_at').eq('application_id', id).order('decided_at', { ascending: false }).limit(1),
      supabaseAdmin.from('unit_tenant_contacts').select('lease_end').eq('association_code', code).eq('unit_ref', unitRef).maybeSingle(),
    ])
    const last = [a.updated_at, docs?.[0]?.created_at, rev?.[0]?.decided_at].filter(Boolean).map(String).sort().pop() ?? null
    const idleDays = last ? days(last) : days(String(a.created_at))
    const leaseEnd = (tc?.lease_end as string | null) ?? null
    const leaseEndedDaysAgo = leaseEnd ? days(`${leaseEnd}T12:00:00Z`) : null
    const d = dashById.get(id)
    const stage = d?.stage ?? 'unknown'
    const flags: string[] = []
    const type = String(a.application_type ?? '')
    if ((docs ?? []).length === 0 && days(String(a.created_at)) >= 14) flags.push(`No document in ${days(String(a.created_at))} days`)
    if (idleDays >= 21 && stage === 'applicant') flags.push(`Idle ${idleDays} days, waiting on the applicant`)
    if (type === 'lease_renewal' && leaseEndedDaysAgo != null && leaseEndedDaysAgo > 60) flags.push(`Renewal for a lease that ended ${leaseEndedDaysAgo} days ago`)
    const suggestExpire = (stage === 'applicant' || stage === 'refused') && (
      ((docs ?? []).length === 0 && days(String(a.created_at)) >= 14) ||
      (idleDays >= 21 && (type !== 'lease_renewal' || (leaseEndedDaysAgo ?? 0) > 60))
    )
    rows.push({
      id, unitLabel: unit, unitRef, type, status: String(a.status), applicants: (stk ?? []).map(s => String(s.name ?? '')).filter(Boolean),
      createdAt: String(a.created_at), lastActivityAt: last, idleDays, documents: (docs ?? []).length,
      stage, stageLabel: d?.stageLabel ?? stage,
      leaseEndOnFile: leaseEnd, leaseEndedDaysAgo,
      driveFolderId: (a.drive_folder_id as string | null) ?? null, driveFolderUrl: (a.drive_folder_url as string | null) ?? null, driveFolderPresent: false,
      flags, suggestExpire,
      notice: a.expiry_notice_kind && a.expiry_due_at ? { kind: String(a.expiry_notice_kind), dueAt: String(a.expiry_due_at) } : null,
    })
  }

  // ── Drive: what is actually under the On Going root ─────────────────
  const folders: Housekeeping['folders'] = { ok: false, error: null, ongoingRootUrl: null, duplicates: [], orphans: [], unparsed: [] }
  try {
    const roots = await resolveAssocDriveFolders(code)
    if (!roots.ongoing) throw new Error(`${code} has no "On Going Applications" folder configured.`)
    folders.ongoingRootUrl = `https://drive.google.com/drive/folders/${roots.ongoing}`
    const drive = getDrive()
    const list = await drive.files.list({
      q: `'${roots.ongoing}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id, name, createdTime, webViewLink)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true,
    })
    const all: HousekeepingFolder[] = []
    for (const f of list.data.files ?? []) {
      if (!f.id || !f.name) continue
      const kids = await drive.files.list({ q: `'${f.id}' in parents and trashed = false`, fields: 'files(id)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true })
      const unitRef = unitRefFromFolder(f.name, code)
      all.push({ id: f.id, name: f.name, unitRef, fileCount: (kids.data.files ?? []).length, createdAt: f.createdTime ?? null, url: f.webViewLink ?? `https://drive.google.com/drive/folders/${f.id}`, openApplicationIds: [] })
    }
    const openByUnit = new Map<string, HousekeepingApp[]>()
    for (const r of rows) openByUnit.set(r.unitRef, [...(openByUnit.get(r.unitRef) ?? []), r])
    const byUnit = new Map<string, HousekeepingFolder[]>()
    for (const f of all) {
      if (!f.unitRef) { folders.unparsed.push(f); continue }
      const open = openByUnit.get(f.unitRef) ?? []
      f.openApplicationIds = open.map(o => o.id)
      for (const o of open) if (o.driveFolderId === f.id) o.driveFolderPresent = true
      byUnit.set(f.unitRef, [...(byUnit.get(f.unitRef) ?? []), f])
      if (!open.length) folders.orphans.push(f)
    }
    for (const [unitRef, fs] of byUnit) if (fs.length > 1) folders.duplicates.push({ unitRef, folders: fs.sort((a, b) => (b.fileCount - a.fileCount) || String(a.createdAt).localeCompare(String(b.createdAt))) })
    folders.duplicates.sort((a, b) => a.unitRef.localeCompare(b.unitRef))
    folders.orphans.sort((a, b) => a.name.localeCompare(b.name))
    // An app whose recorded folder id is not under the root any more (or has
    // none) but whose unit has exactly one folder there: adopt it instead of
    // creating a second one.
    for (const r of rows) {
      if (r.driveFolderPresent) continue
      const fs = byUnit.get(r.unitRef) ?? []
      if (fs.length === 1) { r.driveFolderId = fs[0].id; r.driveFolderUrl = fs[0].url; r.driveFolderPresent = true; r.flags.push('Drive folder found by unit (not linked on the application)') }
    }
    folders.ok = true
  } catch (e) { folders.error = e instanceof Error ? e.message : String(e) }

  const missingFolders = folders.ok ? rows.filter(r => !r.driveFolderPresent) : []
  return {
    associationCode: code, generatedAt: now, apps: rows, folders, missingFolders,
    recentlyClosed: (closedRows ?? []).map(r => ({ id: String(r.id), unitLabel: (r.unit_label as string | null) ?? null, status: String(r.status), at: (r.withdrawn_at as string | null) ?? null, reason: (r.withdrawn_reason as string | null) ?? null })),
  }
}
