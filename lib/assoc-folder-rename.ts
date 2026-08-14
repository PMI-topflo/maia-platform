// =====================================================================
// lib/assoc-folder-rename.ts
//
// Renames an association's per-unit Drive folders to "ACCOUNT_ADDRESS"
// (e.g. "VPCI25J_2300 NE 7th St"), matching each existing folder to a real
// unit by the address and/or unit number buried in its name.
//
// Written association-agnostic on purpose: Venetian Park I is the first of ~24
// associations whose Unit Docs folders were named by hand over several years
// ("911 NE 24 ave ", "2418 NE 9th St Unit: # 79", "VPCI59K - 804 NE 25th Ave
// # 59"). The matching rules below are what make those resolvable.
//
// PLAN FIRST. Nothing renames until the caller passes apply — and every
// applied rename records the previous name so the whole run is reversible.
// =====================================================================

import { getDrive, serviceAccountEmail } from '@/lib/drive-invoice-mirror'
import { supabaseAdmin } from '@/lib/supabase-admin'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface UnitRef { accountNumber: string; unitNumber: string; address: string }
export interface RenamePlanRow {
  fileId: string
  currentName: string
  proposedName: string | null
  accountNumber: string | null
  matchedBy: 'account-number' | 'address' | 'address+unit' | null
  reason?: string
}
export interface RenamePlan {
  ok: boolean
  serviceAccount: string
  accessError?: string
  rows: RenamePlanRow[]
  applied?: { fileId: string; from: string; to: string; error?: string }[]
}

/** Street types normalised so "610 NE 25th Avenue" and "610 NE 25 ave," match. */
function normAddress(s: string): string {
  return s.toLowerCase()
    .replace(/[#,.]/g, ' ')
    .replace(/\b(avenue|ave)\b/g, 'av')
    .replace(/\b(street|str|st)\b/g, 'st')
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')   // 25th -> 25
    .replace(/\s+/g, ' ')
    .trim()
}

/** The leading house number — the strongest single signal in these names. */
function houseNumber(s: string): string | null {
  const m = /\b(\d{3,4})\b/.exec(s)
  return m ? m[1] : null
}

/** Tidy an address for the new folder name: collapse whitespace, title-case
 *  the street type. CINC's own addresses are inconsistent ("2300 NE 7th",
 *  "2400 NE 9TH ST"), so the stored value is normalised rather than echoed. */
export function tidyAddress(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim()
  const withType = /\b(ave|avenue|st|street|dr|drive|blvd|ct|court|ter|terrace)\b/i.test(s) ? s : `${s} St`
  return withType
    .replace(/\bavenue\b/gi, 'Ave').replace(/\bave\b/gi, 'Ave')
    .replace(/\bstreet\b/gi, 'St').replace(/\bst\b/gi, 'St')
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_m, n, sfx) => `${n}${sfx.toLowerCase()}`)
    .replace(/\s+/g, ' ').trim()
}

/** Every active unit for an association, keyed for matching. */
export async function loadUnitRefs(associationCode: string): Promise<UnitRef[]> {
  const { data } = await supabaseAdmin.from('owners')
    .select('account_number, unit_number, address')
    .eq('association_code', associationCode)
    .or('status.neq.previous,status.is.null')
  const seen = new Map<string, UnitRef>()
  for (const o of data ?? []) {
    const acct = String(o.account_number ?? '').trim()
    if (!acct || seen.has(acct)) continue
    seen.set(acct, { accountNumber: acct, unitNumber: String(o.unit_number ?? '').trim(), address: String(o.address ?? '').trim() })
  }
  return [...seen.values()]
}

/** Match one folder name to a unit. Three rules, most-specific first. */
export function matchFolder(name: string, units: UnitRef[]): { unit: UnitRef; by: RenamePlanRow['matchedBy'] } | null {
  const upper = name.toUpperCase().replace(/\s+/g, '')
  // 1. The account number is already in the name ("... - VPCI50K").
  const byAcct = units.find(u => upper.includes(u.accountNumber.toUpperCase()))
  if (byAcct) return { unit: byAcct, by: 'account-number' }

  const n = normAddress(name)
  const house = houseNumber(name)
  // 2. Address match, confirmed by the house number so "2410" never takes "2418".
  const addrHits = units.filter(u => {
    const a = normAddress(u.address)
    return !!house && houseNumber(u.address) === house && (n.includes(a) || a.includes(n.split(' ').slice(0, 4).join(' ')))
  })
  if (addrHits.length === 1) return { unit: addrHits[0], by: 'address' }

  // 3. Ambiguous address — let the unit number in the name break the tie.
  if (addrHits.length > 1) {
    const unitTok = /(?:unit|#|no\.?)\s*:?\s*#?\s*([0-9]+[a-z]?)/i.exec(name)?.[1]
    if (unitTok) {
      const hit = addrHits.find(u => u.unitNumber.toUpperCase().startsWith(unitTok.toUpperCase()))
      if (hit) return { unit: hit, by: 'address+unit' }
    }
  }
  return null
}

/** Build (and optionally apply) the rename plan for one association's folder. */
export async function planUnitFolderRenames(opts: {
  associationCode: string
  rootFolderId: string
  apply?: boolean
}): Promise<RenamePlan> {
  const sa = serviceAccountEmail() ?? 'unknown'
  const drive = getDrive()

  let folders: { id: string; name: string }[] = []
  try {
    const res = await drive.files.list({
      q: `'${opts.rootFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id,name)', pageSize: 500, supportsAllDrives: true, includeItemsFromAllDrives: true,
    })
    folders = (res.data.files ?? []).map(f => ({ id: String(f.id), name: String(f.name) }))
  } catch (err) {
    // The single most likely failure, and the one worth naming precisely:
    // the folder was never shared with the service account.
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false, serviceAccount: sa, rows: [],
      accessError: `MAIA cannot read that Drive folder: ${msg}. Share it with ${sa} as Editor.`,
    }
  }

  const units = await loadUnitRefs(opts.associationCode)
  const rows: RenamePlanRow[] = folders.map(f => {
    const hit = matchFolder(f.name, units)
    if (!hit) return { fileId: f.id, currentName: f.name, proposedName: null, accountNumber: null, matchedBy: null, reason: 'no unit matched — rename by hand' }
    const proposed = `${hit.unit.accountNumber}_${tidyAddress(hit.unit.address)}`
    return {
      fileId: f.id, currentName: f.name, proposedName: proposed,
      accountNumber: hit.unit.accountNumber, matchedBy: hit.by,
      reason: proposed === f.name ? 'already named correctly' : undefined,
    }
  }).sort((a, b) => (a.accountNumber ?? 'zzz').localeCompare(b.accountNumber ?? 'zzz'))

  if (!opts.apply) return { ok: true, serviceAccount: sa, rows }

  const applied: NonNullable<RenamePlan['applied']> = []
  for (const r of rows) {
    if (!r.proposedName || r.proposedName === r.currentName) continue
    try {
      await drive.files.update({ fileId: r.fileId, requestBody: { name: r.proposedName }, supportsAllDrives: true })
      // Record the previous name so a bad run can be walked back.
      await supabaseAdmin.from('drive_folder_renames').insert({
        association_code: opts.associationCode, file_id: r.fileId,
        previous_name: r.currentName, new_name: r.proposedName,
      }).then(x => x, () => null)
      applied.push({ fileId: r.fileId, from: r.currentName, to: r.proposedName })
    } catch (err) {
      applied.push({ fileId: r.fileId, from: r.currentName, to: r.proposedName, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ok: true, serviceAccount: sa, rows, applied }
}
