// =====================================================================
// lib/drive-ongoing.ts
//
// Organize the "On Going Applications" Drive tree into the standard shape:
//   Unit ###  →  MANXI###
//     └─ YYYY_MM_<first applicant's first name>/   (from the lease/approval)
//          all the unit's files, moved in + renamed YYYY_MM_Type
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

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface OngoingFilePlan { fileId: string; currentName: string; newName: string; kind: string }
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
  const m = String(name).match(/(?:unit|manxi)\s*0*(\d+)/i)
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
// date, matching the rest of the organize tool). PII / unrecognized files keep
// their name — they still belong in the packet, just not renamed. Insurance is
// left generic ("Insurance") on purpose: a filename can't tell HO-6 from a
// liability binder, so we don't claim a policy type here.
function proposeFileName(name: string, createdTime: string | null): { newName: string; kind: string } {
  const d = filterDriveFile(name, null)
  if (!d.include) return { newName: name, kind: d.category }   // keep name, just move
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

/** Files sitting directly inside a unit folder (not subfolders). */
async function listUnitFiles(folderId: string): Promise<{ id: string; name: string; createdTime: string | null }[]> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name, createdTime)', pageSize: 200,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  return (res.data.files ?? []).map(f => ({ id: f.id as string, name: f.name ?? 'file', createdTime: f.createdTime ?? null }))
}

// Which file to read for the applicant name + lease start — prefer the
// approval, then a lease, then an affidavit, else the first file.
function pickSource(files: { id: string; name: string }[]): string | null {
  for (const rx of [/approval/i, /lease/i, /affidav/i]) {
    const hit = files.find(f => rx.test(f.name)); if (hit) return hit.id
  }
  return files[0]?.id ?? null
}

/** Build the reorganization plan for one On Going unit folder (reads one doc
 *  for the applicant name + lease start). Never throws. */
export async function planOngoingUnit(folder: { id: string; name: string }): Promise<OngoingUnitPlan> {
  const warnings: string[] = []
  const unitRef = unitRefFromFolder(folder.name)
  if (!unitRef) warnings.push('Could not read the unit number from the folder name.')

  const files = await listUnitFiles(folder.id)
  if (files.length === 0) warnings.push('This folder has no files.')

  let firstApplicant: string | null = null
  let leaseStart: string | null = null
  const srcId = pickSource(files)
  if (srcId) {
    try {
      const buf = await downloadDriveFile(srcId)
      const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
      const lease = await extractLeaseDetails(buf, isPdf ? 'application/pdf' : 'image/jpeg')
      firstApplicant = lease.tenantNames[0] ?? null
      leaseStart = lease.leaseStart
    } catch { warnings.push('Could not read a document to detect the applicant.') }
  }

  const fn = firstApplicant ? firstNameOf(firstApplicant) : null
  const ym = yyyymm(leaseStart)   // "2026_06" | null
  if (!fn) warnings.push('No applicant name detected — set the subfolder name manually.')
  if (!ym) warnings.push('No lease start date detected — set the month manually.')
  const subfolderName = (ym && fn) ? `${ym}_${fn}` : ([ym, fn].filter(Boolean).join('_') || null)

  const proposed = files.map(f => proposeFileName(f.name, f.createdTime))
  const deduped = dedupeNames(proposed.map(p => p.newName))
  const filePlans: OngoingFilePlan[] = files.map((f, i) => ({
    fileId: f.id, currentName: f.name, newName: deduped[i] ?? f.name, kind: proposed[i].kind,
  }))

  return { folderId: folder.id, currentName: folder.name, unitRef, newFolderName: unitRef, subfolderName, firstApplicant, leaseStart, files: filePlans, warnings }
}

/** Execute one unit's plan: rename the folder → MANXI###, create the
 *  YYYY_MM_Name subfolder, move + rename every file into it. */
export async function applyOngoingUnit(p: {
  folderId: string; newFolderName: string; subfolderName: string
  files: { fileId: string; newName: string }[]
}): Promise<{ renamed: number; moved: number }> {
  const sub = p.subfolderName.replace(/[\/\\\x00-\x1f]/g, ' ').trim()
  const folderName = p.newFolderName.replace(/[\/\\\x00-\x1f]/g, ' ').trim()
  if (!folderName || !sub) throw new Error('folder name and subfolder name required')

  const drive = getDrive()
  // 1. rename the unit folder → MANXI###
  await drive.files.update({ fileId: p.folderId, requestBody: { name: folderName }, supportsAllDrives: true })
  // 2. find/create the dated subfolder under it
  const subId = await resolveDatedSubfolder(p.folderId, sub, true)
  if (!subId) throw new Error('could not create the subfolder')

  // 3. move + rename each file into the subfolder
  let renamed = 0, moved = 0
  for (const f of p.files) {
    const meta = await drive.files.get({ fileId: f.fileId, fields: 'parents, name', supportsAllDrives: true })
    if ((meta.data.parents ?? []).includes(subId) && meta.data.name === f.newName) continue   // already done
    const removeParents = (meta.data.parents ?? []).filter(id => id !== subId).join(',')
    const rename = f.newName && f.newName !== meta.data.name
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
  return { renamed, moved }
}
