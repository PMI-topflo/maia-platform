// =====================================================================
// lib/drive-ongoing.ts
//
// Organize the "On Going Applications" Drive tree into the standard shape:
//   Unit ###  →  MANXI###
//     └─ YYYY_MM_<first applicant's first name>/   (from the lease/approval)
//          all the unit's files, moved in (from any subfolder) + renamed
//
// YYYY_MM is the LEASE / APPLICATION START month (read from the docs). On the
// board's FINAL approval, the dated subfolder is merged into the unit's
// existing "MANXI### Last File <year>" folder in the OLD/Archive tree — that
// move is a separate action, not here. All ops run as the SA impersonating
// PMI (getDrive), so they only work in production where the SA key is set.
// =====================================================================

import { getDrive } from '@/lib/drive-invoice-mirror'
import { downloadDriveFile } from '@/lib/drive-import'
import { extractLeaseDetails } from '@/lib/lease-extract'
import { filterDriveFile } from '@/lib/drive-import-filter'
import { yyyymm, dedupeNames } from '@/lib/drive-organize'
import { resolveDatedSubfolder, DRIVE_FOLDERS } from '@/lib/drive-organize-folders'
import { supabaseAdmin } from '@/lib/supabase-admin'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const MAX_READS = 3   // how many candidate docs to read per unit for the applicant/date

export interface OngoingFilePlan { fileId: string; currentName: string; newName: string; kind: string; createdTime: string | null; webViewLink: string | null }
export interface OngoingUnitPlan {
  folderId: string
  currentName: string
  unitRef: string | null           // MANXI###
  newFolderName: string | null     // MANXI###
  subfolderName: string | null     // YYYY_MM_First
  firstApplicant: string | null
  leaseStart: string | null        // ISO
  files: OngoingFilePlan[]
  warnings: string[]
}

/** "Unit 910" / "MANXI910" / "unit 0910 - note" → "MANXI910". */
export function unitRefFromFolder(name: string): string | null {
  const m = String(name).match(/\b(?:unit|manxi)\s*#?\s*0*(\d{1,4})\b/i)
  return m ? `MANXI${m[1]}` : null
}

/** "Yuhao Zhou" → "Yuhao" (letters only, so it's filename-safe). */
function firstNameOf(full: string): string {
  const tok = full.trim().split(/\s+/)[0] ?? ''
  return tok.replace(/[^A-Za-z]/g, '')
}

function ext(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,5})$/i)
  return m ? `.${m[1].toLowerCase()}` : ''
}

// Propose a YYYY_MM_Type name for a keeper file (date = the file's created
// date). PII / unrecognized files keep their name — they still belong in the
// packet, just not renamed. Insurance is left generic ("Insurance"): a filename
// can't tell HO-6 from a liability binder, so we don't claim a policy type.
function proposeFileName(name: string, createdTime: string | null): { newName: string; kind: string } {
  const d = filterDriveFile(name, null)
  if (!d.include) return { newName: name, kind: d.category }
  const ym = yyyymm(createdTime)
  const type =
    d.category === 'approval' ? 'Approval' :
    d.category === 'lease' ? 'Lease' :
    d.category === 'affidavit' ? 'Affidavit' :
    d.category === 'certificate_of_use' ? 'LauderhillCert' :
    d.category === 'insurance' ? 'Insurance' : null
  if (!type || !ym) return { newName: name, kind: d.category }
  return { newName: `${ym}_${type}${ext(name)}`, kind: d.category }
}

/** The real Manors XI unit account numbers (MANXI###) from CINC/owners, so a
 *  bad folder-name parse (e.g. MANXI11002) can be flagged — the real unit is
 *  MANXI1002. */
export async function loadKnownUnitRefs(assoc = 'MANXI'): Promise<Set<string>> {
  const set = new Set<string>()
  let from = 0
  for (;;) {
    const { data } = await supabaseAdmin.from('owners').select('account_number').eq('association_code', assoc).range(from, from + 999)
    for (const r of data ?? []) { const a = (r.account_number as string | null)?.trim(); if (a) set.add(a.toUpperCase()) }
    if (!data || data.length < 1000) break
    from += 1000
  }
  return set
}

/** List the immediate child folders of the On Going root. */
export async function scanOngoingUnits(rootId: string = DRIVE_FOLDERS.ongoing): Promise<{ id: string; name: string }[]> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name)', orderBy: 'name', pageSize: 200,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  return (res.data.files ?? []).map(f => ({ id: f.id as string, name: f.name ?? '' }))
}

/** Every file under a unit folder AT ANY DEPTH (application docs are often in a
 *  "2026_2027" / lease-term subfolder, not loose at the top). Follows folders. */
async function listUnitFilesDeep(rootId: string): Promise<{ id: string; name: string; createdTime: string | null; webViewLink: string | null }[]> {
  const drive = getDrive()
  const out: { id: string; name: string; createdTime: string | null; webViewLink: string | null }[] = []
  let frontier = [rootId]
  const seen = new Set<string>()
  let guard = 0
  while (frontier.length && guard < 400) {
    const next: string[] = []
    for (const fid of frontier) {
      if (seen.has(fid)) continue
      seen.add(fid); guard++
      const res = await drive.files.list({
        q: `'${fid}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType, createdTime, webViewLink)', pageSize: 200,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) { if (f.id) next.push(f.id) }
        else out.push({ id: f.id as string, name: f.name ?? 'file', createdTime: f.createdTime ?? null, webViewLink: f.webViewLink ?? null })
      }
    }
    frontier = next
  }
  return out
}

// Read order: files whose NAME hints at the applicant/lease first, then the
// rest (a multi-page scan named "processed-xxxx.jpeg" gives nothing away, so we
// just read the first few until we find a name + date).
function orderCandidates(files: { id: string; name: string }[]): { id: string; name: string }[] {
  const score = (n: string) => /approval/i.test(n) ? 4 : /lease|rental|tenanc|amend/i.test(n) ? 3 : /affidav/i.test(n) ? 2 : /\.pdf$/i.test(n) ? 1 : 0
  return [...files].sort((a, b) => score(b.name) - score(a.name))
}

/** Build the reorganization plan for one On Going unit folder. Reads up to a
 *  few docs (recursively, incl. subfolders) for the applicant name + lease
 *  start. Validates the unit number against CINC when `knownRefs` is given.
 *  Never throws. */
export async function planOngoingUnit(folder: { id: string; name: string }, knownRefs?: Set<string>): Promise<OngoingUnitPlan> {
  const warnings: string[] = []
  const unitRef = unitRefFromFolder(folder.name)
  if (!unitRef) warnings.push('Could not read the unit number from the folder name.')
  else if (knownRefs && knownRefs.size && !knownRefs.has(unitRef.toUpperCase())) warnings.push(`${unitRef} is not a known Manors XI unit — double-check the number.`)

  const files = await listUnitFilesDeep(folder.id)
  if (files.length === 0) warnings.push('This folder (and its subfolders) has no files.')

  let firstApplicant: string | null = null
  let leaseStart: string | null = null
  let reads = 0
  for (const c of orderCandidates(files)) {
    if (reads >= MAX_READS || (firstApplicant && leaseStart)) break
    try {
      const buf = await downloadDriveFile(c.id)
      reads++
      const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
      const lease = await extractLeaseDetails(buf, isPdf ? 'application/pdf' : 'image/jpeg')
      if (!firstApplicant && lease.tenantNames[0]) firstApplicant = lease.tenantNames[0]
      if (!leaseStart && lease.leaseStart) leaseStart = lease.leaseStart
    } catch { /* try the next candidate */ }
  }

  const fn = firstApplicant ? firstNameOf(firstApplicant) : null
  const ym = yyyymm(leaseStart)
  if (!fn) warnings.push('No applicant name detected — set the subfolder name manually.')
  if (!ym) warnings.push('No lease start date detected — set the month manually.')
  const subfolderName = (ym && fn) ? `${ym}_${fn}` : ([ym, fn].filter(Boolean).join('_') || null)

  const proposed = files.map(f => proposeFileName(f.name, f.createdTime))
  const deduped = dedupeNames(proposed.map(p => p.newName))
  const filePlans: OngoingFilePlan[] = files.map((f, i) => ({
    fileId: f.id, currentName: f.name, newName: deduped[i] ?? f.name, kind: proposed[i].kind, createdTime: f.createdTime, webViewLink: f.webViewLink,
  }))

  return { folderId: folder.id, currentName: folder.name, unitRef, newFolderName: unitRef, subfolderName, firstApplicant, leaseStart, files: filePlans, warnings }
}

/** Execute one unit's plan. ALWAYS renames the folder → MANXI### (that only
 *  needs the unit number). Only when a subfolder name is given does it also
 *  create the YYYY_MM_Name subfolder and move + rename the files into it —
 *  units with no detected applicant/date still get standardized (files stay
 *  put until a name is set + re-applied). Re-runnable. */
export async function applyOngoingUnit(p: {
  folderId: string; newFolderName: string; subfolderName?: string
  files: { fileId: string; newName: string }[]
}): Promise<{ folderRenamed: boolean; subfolder: boolean; renamed: number; moved: number }> {
  const sub = (p.subfolderName ?? '').replace(/[\/\\\x00-\x1f]/g, ' ').trim()
  const folderName = p.newFolderName.replace(/[\/\\\x00-\x1f]/g, ' ').trim()
  if (!folderName) throw new Error('folder name required')

  const drive = getDrive()
  // 1. rename the unit folder → MANXI### (always).
  await drive.files.update({ fileId: p.folderId, requestBody: { name: folderName }, supportsAllDrives: true })

  // 2. subfolder + file moves only when we have a name for the subfolder.
  if (!sub) return { folderRenamed: true, subfolder: false, renamed: 0, moved: 0 }
  const subId = await resolveDatedSubfolder(p.folderId, sub, true)
  if (!subId) throw new Error('could not create the subfolder')

  let renamed = 0, moved = 0
  for (const f of p.files) {
    const meta = await drive.files.get({ fileId: f.fileId, fields: 'parents, name', supportsAllDrives: true })
    if ((meta.data.parents ?? []).includes(subId) && meta.data.name === f.newName) continue
    const removeParents = (meta.data.parents ?? []).filter(id => id !== subId).join(',')
    const rename = !!f.newName && f.newName !== meta.data.name
    await drive.files.update({
      fileId: f.fileId,
      addParents: subId,
      removeParents: removeParents || undefined,
      requestBody: rename ? { name: f.newName } : undefined,
      supportsAllDrives: true,
    })
    if (rename) renamed++
    moved++
  }
  return { folderRenamed: true, subfolder: true, renamed, moved }
}
