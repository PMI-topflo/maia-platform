// =====================================================================
// lib/drive-organize-folders.ts
//
// The three Manors XI top-level Drive folders (renamed 2026-07-30, same IDs /
// share links) and helpers to resolve a unit's folder inside them. Env-
// overridable so this isn't hard-wired to Manors XI forever.
//
//   OFFICIAL  "Unit Docs - 2026 Maia Official Files"     → clean renamed record
//   ARCHIVE   "Unit Docs - OLD Approved Application Files" → past applications (kept)
//   ONGOING   "Unit Docs - On Going Applications"          → in-progress, pre-approval
// =====================================================================

import { getDrive } from '@/lib/drive-invoice-mirror'

// Manors XI's three folders. Still the default for the MANXI-specific bulk
// organize tooling under /admin/documents/organize, which only ever ran against
// this association. The APPLICATION pipeline no longer uses these directly —
// see resolveAssocDriveFolders() — because a Venetian I application filing its
// documents into Manors XI's Drive tree is a silent, wrong, and very annoying
// thing to discover later.
export const DRIVE_FOLDERS = {
  official: process.env.MANXI_OFFICIAL_FOLDER_ID ?? '1kRDm6ajZr8lXuXGcAXTnA3vigzhLCZpz',
  archive:  process.env.MANXI_ARCHIVE_FOLDER_ID  ?? '11mMQghXeQfPuXEO4YnWgecqaTKuLKhs8',
  ongoing:  process.env.MANXI_ONGOING_FOLDER_ID  ?? '1rX11uKdi5y0rAfaLPvRRlJ_aCactViuZ',
} as const

export interface AssocDriveFolders { official: string | null; archive: string | null; ongoing: string | null }

/** The three Drive folders for ONE association. Falls back to the Manors XI
 *  constants only for MANXI itself — every other association must have its own
 *  folders configured, and gets nulls (callers refuse to file) until it does.
 *  Silently defaulting would put one association's documents in another's. */
export async function resolveAssocDriveFolders(associationCode: string): Promise<AssocDriveFolders> {
  const code = associationCode.trim().toUpperCase()
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data } = await supabaseAdmin.from('associations')
    .select('official_folder_id, archive_folder_id, ongoing_folder_id')
    .eq('association_code', code).maybeSingle()
  const fallback = code === 'MANXI' ? DRIVE_FOLDERS : { official: null, archive: null, ongoing: null }
  return {
    official: (data?.official_folder_id as string | null) || fallback.official,
    archive:  (data?.archive_folder_id  as string | null) || fallback.archive,
    ongoing:  (data?.ongoing_folder_id  as string | null) || fallback.ongoing,
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Suffix put on a unit folder in Official that has no documents yet, so empty
// units are visible at a glance. Stripped automatically when a file lands.
export const NO_FILES_TAG = ' - NO FILES YET'
export function stripNoFilesTag(name: string): string {
  return name.replace(/\s*-\s*NO FILES YET\s*$/i, '').trimEnd()
}

/** Canonical per-unit folder name in the Official tree, e.g.
 *  "MANXI811 - 4174 Inverrary Drive".
 *
 *  The address is the UNIT'S, not the association's. Manors XI is one building
 *  on one street so a constant worked; Venetian Park I is 60 units across a
 *  dozen streets, and naming them all "4174 Inverrary Drive" would be wrong on
 *  every single one. Falls back to the old constant only when no address is
 *  supplied, so existing MANXI folders keep matching. */
export function unitFolderName(unitRef: string, address?: string | null): string {
  const addr = (address ?? '').replace(/\s+/g, ' ').trim() || '4174 Inverrary Drive'
  return `${unitRef} - ${addr}`
}

/** The unit's real account number for an application's unit label.
 *
 *  `${code}${digits}` only works where accounts ARE code+digits (Manors XI).
 *  Venetian Park I's are VPCI91M / VPCI25J — a trailing building letter that no
 *  amount of string-building recovers — so this looks the account up in CINC
 *  and only falls back to the old construction when there's no match. */
export async function resolveUnitRef(associationCode: string, unitLabel: string | null): Promise<string> {
  const code = associationCode.trim().toUpperCase()
  const label = String(unitLabel ?? '').trim()
  const digits = label.replace(/\D/g, '')
  if (label) {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const { data } = await supabaseAdmin.from('owners')
      .select('account_number, unit_number').eq('association_code', code)
    for (const o of data ?? []) {
      const acct = String(o.account_number ?? '')
      const unit = String(o.unit_number ?? '')
      if (!acct) continue
      if (unit.toUpperCase() === label.toUpperCase()) return acct
      if (acct.toUpperCase() === label.toUpperCase()) return acct
      if (digits && unit.replace(/\D/g, '') === digits) return acct
    }
  }
  return `${code}${digits}`
}

/** The unit's street address from CINC, used to name its folder. Same source
 *  that drove the Venetian I folder renames correctly. */
export async function unitAddress(associationCode: string, unitRef: string): Promise<string | null> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data } = await supabaseAdmin.from('owners')
    .select('address').eq('association_code', associationCode.toUpperCase())
    .eq('account_number', unitRef).limit(1).maybeSingle()
  return (data?.address as string | null) ?? null
}

/** Find (or create, when create=true) the folder for a unit directly under
 *  `parentId`. Matches on the folder name STARTING with the unit ref (so the
 *  existing "MANXI811 - 4174 Inverrary Drive" is reused). Returns its id. */
export async function resolveUnitFolder(parentId: string, unitRef: string, create: boolean): Promise<string | null> {
  const drive = getDrive()
  // Look for an existing child folder whose name begins with the unit ref.
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name contains '${unitRef}'`,
    fields: 'files(id, name)', pageSize: 50, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  const rx = new RegExp(`^${unitRef}\\b`, 'i')
  const hit = (res.data.files ?? []).find(f => rx.test(f.name ?? ''))
  if (hit?.id) return hit.id
  if (!create) return null

  const created = await drive.files.create({
    requestBody: { name: unitFolderName(unitRef), mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id', supportsAllDrives: true,
  })
  return created.data.id ?? null
}

/** The Official category subfolder an approval belongs in, by approval kind. */
export function approvalCategoryFolder(kind: string): string {
  return kind === 'purchase' ? 'Purchase Applications' : 'Lease Applications'
}

/** Find (or create) a dated subfolder under a unit's archive folder, e.g.
 *  ".../MANXI811 - …/2026-06". Also used to resolve named category subfolders
 *  (e.g. "Lease Applications") under a unit's Official folder. */
export async function resolveDatedSubfolder(unitFolderId: string, dateLabel: string, create: boolean): Promise<string | null> {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${unitFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and name = '${dateLabel}'`,
    fields: 'files(id, name)', pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  if (res.data.files?.[0]?.id) return res.data.files[0].id
  if (!create) return null
  const created = await drive.files.create({
    requestBody: { name: dateLabel, mimeType: FOLDER_MIME, parents: [unitFolderId] },
    fields: 'id', supportsAllDrives: true,
  })
  return created.data.id ?? null
}
