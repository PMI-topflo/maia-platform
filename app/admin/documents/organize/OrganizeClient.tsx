'use client'

import { Fragment, useMemo, useState } from 'react'
import { DocumentPreviewTrigger } from '@/components/DocumentPreviewTrigger'
import { proposeName, dedupeNames, RENAME_TYPES, TYPE_FOR_CATEGORY } from '@/lib/drive-organize'
import type { FilterCategory } from '@/lib/drive-import-filter'

interface ScanFile {
  id: string; name: string; path: string; createdTime: string | null; webViewLink: string | null
  category: FilterCategory; include: boolean; reason: string; sourceMimeType?: string
}
interface Detected { scope: string; category: string | null; itemKey: string | null; docType: string | null; effectiveDate: string | null; expirationDate: string | null; confidence: number }
interface LeaseInfo { tenantNames: string[]; ownerNames: string[]; leaseStart: string | null; leaseEnd: string | null; monthlyRent: string | null }
interface InsuranceInfo { policyType: 'ho6' | 'ho4' | 'liability_only' | 'other'; namedInsured: string | null; insuredIsEntity: boolean; hasDwellingCoverage: boolean; hasPersonalProperty: boolean; hasLossAssessment: boolean; hasLiability: boolean; adequateForUnit: boolean; recommendation: string | null; expirationDate: string | null }
interface ReadResult { ok?: boolean; error?: string; associationCode?: string; unitRef?: string | null; summary?: string | null; detected?: Detected | null; lease?: LeaseInfo | null; insurance?: InsuranceInfo | null; tenantOwnerMatch?: string | null }

// The rename Type token MAIA's read implies — insurance verdict (by coverages)
// wins over the item/label mapping so a liability-only binder isn't "HO6".
function readTypeToken(rr: ReadResult): string | null {
  const ins = rr.insurance
  if (ins && ins.policyType !== 'other') return ins.policyType === 'ho4' ? 'HO4' : ins.policyType === 'liability_only' ? 'Liability' : 'HO6'
  return rr.detected ? typeFromDetected(rr.detected.itemKey, rr.detected.category, rr.detected.docType) : null
}

// "Unit 910" / "MANXI910 - 4174 Inverrary Drive" → MANXI910
function unitFromName(name: string | null): string | null {
  const m = String(name ?? '').match(/MANXI\s*0*(\d+)/i) || String(name ?? '').match(/\bunit\s*0*(\d+)/i)
  return m ? `MANXI${m[1]}` : null
}

// Map what MAIA detected to a rename Type token. Checks the item_key, the
// category, AND the human-readable doc label — the Lauderhill Certificate of
// Use isn't a standard compliance item, so it's only recognizable from the
// label ("City of Lauderhill … Certificate of Use"). Approval is checked first
// so "Lease Approval Letter" maps to Approval, not Lease.
function typeFromDetected(itemKey: string | null, category: string | null, docType?: string | null): string | null {
  const hay = `${itemKey ?? ''} ${category ?? ''} ${docType ?? ''}`.toLowerCase()
  if (/approval/.test(hay)) return 'Approval'
  if (/certificate of use|lauderhill|cert.*use|business tax|\bbtr\b|rental license|use permit/.test(hay)) return 'LauderhillCert'
  if (/\bho-?4\b|renter/.test(hay)) return 'HO4'
  if (/\bho-?6\b|\bho-?3\b/.test(hay)) return 'HO6'
  if (/affidavit/.test(hay)) return 'Affidavit'
  if (/lease|rental agreement|tenanc/.test(hay)) return 'Lease'
  if (/insurance|binder|policy|homeowner/.test(hay)) return 'HO6'
  return null
}

interface BrowseFolder { id: string; name: string }
interface BrowseData { parentId: string; current: { id: string; name: string; parentId: string | null } | null; folders: BrowseFolder[] }
type Status = 'idle' | 'saving' | 'done' | 'error'
interface OngoingUnit {
  folderId: string; currentName: string; unitRef: string | null; newFolderName: string | null
  subfolderName: string | null; firstApplicant: string | null; leaseStart: string | null
  files: { fileId: string; currentName: string; newName: string; kind: string; createdTime: string | null; webViewLink: string | null }[]; warnings: string[]
}

const CAT_LABEL: Record<string, string> = {
  approval: 'Approval', certificate_of_use: 'Cert of Use', insurance: 'Insurance', lease: 'Lease', affidavit: 'Affidavit',
  id: 'ID', credit: 'Credit', criminal: 'Background', tax: 'Tax/income', unknown: 'Unrecognized',
}

export default function OrganizeClient() {
  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [files, setFiles] = useState<ScanFile[] | null>(null)
  const [foldersScanned, setFoldersScanned] = useState(0)
  const [names, setNames] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [rowErr, setRowErr] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)
  const [batch, setBatch] = useState<{ label: string; done: number; total: number } | null>(null)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [folderLink, setFolderLink] = useState<string | null>(null)
  // Drive folder browser
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browse, setBrowse] = useState<BrowseData | null>(null)
  const [browsing, setBrowsing] = useState(false)
  // MAIA content-read results, keyed by fileId.
  const [reading, setReading] = useState<Record<string, boolean>>({})
  const [readRes, setReadRes] = useState<Record<string, ReadResult>>({})
  const [filed, setFiled] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<Record<string, boolean>>({})
  const [savedTenant, setSavedTenant] = useState<Record<string, boolean>>({})
  const [requestedIns, setRequestedIns] = useState<Record<string, string>>({})
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({})
  const [promoting, setPromoting] = useState(false)
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null)
  // Empty-subfolder cleanup
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [markUnits, setMarkUnits] = useState(true)
  const [plan, setPlan] = useState<{ emptyCount: number; foldersScanned: number; sample: string[]; deleteIds: string[]; tagPlan: { id: string; newName: string }[] } | null>(null)
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null)
  const [cleanupDone, setCleanupDone] = useState<string | null>(null)
  // OLD-archive reorg
  const [reorgPlan, setReorgPlan] = useState<{ folderRenames: { id: string; newName: string }[]; fileMoves: { id: string; parentId: string; year: string }[]; counts: { renames: number; moves: number; undated: number }; sampleRenames: string[] } | null>(null)
  const [reorgDone, setReorgDone] = useState<string | null>(null)
  // On Going reorg (Unit ### → MANXI###/YYYY_MM_First)
  const [ongoingPlan, setOngoingPlan] = useState<OngoingUnit[] | null>(null)
  const [ongoingBusy, setOngoingBusy] = useState(false)
  const [ongoingDone, setOngoingDone] = useState<string | null>(null)
  const [ongoingEdit, setOngoingEdit] = useState<Record<string, string>>({})   // folderId → edited subfolder name
  const [ongoingOpen, setOngoingOpen] = useState<Record<string, boolean>>({})  // folderId → files expanded

  async function planReorg() {
    if (!url.trim()) { alert('Paste the OLD archive folder link first.'); return }
    setCleanupBusy(true); setReorgPlan(null); setReorgDone(null)
    try {
      const res = await fetch('/api/admin/documents/drive/organize/reorg-archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrl: url }) })
      const j = await res.json(); if (j.error || !j.ok) throw new Error(j.error ?? 'plan failed')
      setReorgPlan({ folderRenames: j.folderRenames ?? [], fileMoves: j.fileMoves ?? [], counts: j.counts, sampleRenames: j.sampleRenames ?? [] })
    } catch (e) { alert(`Archive plan failed: ${(e as Error).message}`) } finally { setCleanupBusy(false) }
  }

  async function applyReorg() {
    if (!reorgPlan) return
    const total = reorgPlan.folderRenames.length + reorgPlan.fileMoves.length
    if (!confirm(`Reorganize the archive?\n\n• Rename ${reorgPlan.folderRenames.length} folder(s) → MANXI### <year> <note>\n• Move ${reorgPlan.fileMoves.length} file(s) into year subfolders`)) return
    setCleanupBusy(true); setReorgDone(null)
    let done = 0, renamed = 0, moved = 0
    try {
      for (const r of reorgPlan.folderRenames) {
        setProgress({ label: 'Renaming folders', done, total })
        const res = await fetch('/api/admin/documents/drive/organize/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: r.id, newName: r.newName }) })
        if ((await res.json().catch(() => ({}))).ok) renamed++
        done++; setProgress({ label: 'Renaming folders', done, total })
      }
      for (const m of reorgPlan.fileMoves) {
        setProgress({ label: 'Moving files into year subfolders', done, total })
        const res = await fetch('/api/admin/documents/drive/organize/move-to-year', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: m.id, parentId: m.parentId, year: m.year }) })
        if ((await res.json().catch(() => ({}))).ok) moved++
        done++; setProgress({ label: 'Moving files into year subfolders', done, total })
      }
      setReorgDone(`Renamed ${renamed} folder(s), moved ${moved} file(s) into year subfolders.`)
      setReorgPlan(null)
    } catch (e) { alert(`Reorg failed: ${(e as Error).message}`) } finally { setProgress(null); setCleanupBusy(false) }
  }

  async function planOngoing() {
    setOngoingBusy(true); setOngoingPlan(null); setOngoingDone(null); setOngoingEdit({})
    try {
      const res = await fetch('/api/admin/documents/drive/organize/ongoing-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const j = await res.json(); if (j.error || !j.ok) throw new Error(j.error ?? 'plan failed')
      setOngoingPlan(j.units ?? [])
    } catch (e) { alert(`On Going plan failed: ${(e as Error).message}`) } finally { setOngoingBusy(false) }
  }

  async function applyOngoing() {
    if (!ongoingPlan) return
    const subOf = (u: OngoingUnit) => (ongoingEdit[u.folderId] ?? u.subfolderName ?? '').trim()
    const doable = ongoingPlan.filter(u => u.newFolderName && subOf(u))
    if (doable.length === 0) { alert('Nothing ready to apply — set a subfolder name for the flagged rows first.'); return }
    if (!confirm(`Organize ${doable.length} On Going folder(s)?\n\nEach → rename to MANXI###, create its dated subfolder, move + rename its files in.`)) return
    setOngoingBusy(true); setOngoingDone(null)
    let done = 0, ok = 0; const total = doable.length
    setProgress({ label: 'Organizing On Going', done, total })
    try {
      for (const u of doable) {
        const res = await fetch('/api/admin/documents/drive/organize/ongoing-apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: u.folderId, newFolderName: u.newFolderName, subfolderName: subOf(u), files: u.files.map(f => ({ fileId: f.fileId, newName: f.newName })) }),
        })
        if ((await res.json().catch(() => ({}))).ok) ok++
        done++; setProgress({ label: 'Organizing On Going', done, total })
      }
      setOngoingDone(`Organized ${ok} of ${total} unit folder(s) into MANXI###/dated subfolders.`)
      setOngoingPlan(null)
    } catch (e) { alert(`Organize failed: ${(e as Error).message}`) } finally { setProgress(null); setOngoingBusy(false) }
  }

  function setOngoingFileName(folderId: string, fileId: string, newName: string) {
    setOngoingPlan(plan => plan?.map(u => u.folderId === folderId ? { ...u, files: u.files.map(f => f.fileId === fileId ? { ...f, newName } : f) } : u) ?? null)
  }

  // ✦ Read a single On Going file, and if MAIA recognizes a keeper type, set its
  // proposed name to YYYY_MM_Type (date = the file's created date) so "Apply
  // all" renames it — this is how the generic "processed-xxxx.jpeg" files get
  // typed. Insurance reads win (a liability binder won't be called HO-6).
  async function readOngoingFile(folderId: string, file: { fileId: string; currentName: string; createdTime: string | null }) {
    setReading(r => ({ ...r, [file.fileId]: true }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: file.fileId, fileName: file.currentName }) })
      const j = (await res.json()) as ReadResult
      const t = readTypeToken(j)
      if (!t) { alert(`MAIA couldn't confidently type "${file.currentName}". Rename it by hand if needed.`); return }
      const ym = file.createdTime ? new Date(file.createdTime).toISOString().slice(0, 7).replace('-', '_') : null
      const e = file.currentName.match(/\.([a-z0-9]{1,5})$/i)?.[0] ?? ''
      if (!ym) { alert(`Read as ${t}, but the file has no date — set the name by hand.`); return }
      setOngoingFileName(folderId, file.fileId, `${ym}_${t}${e}`)
    } catch (e) { alert(`Read failed: ${(e as Error).message}`) } finally { setReading(r => ({ ...r, [file.fileId]: false })) }
  }

  async function findCleanup() {
    if (!url.trim()) { alert('Paste a Drive folder link first.'); return }
    setCleanupBusy(true); setPlan(null); setCleanupDone(null)
    try {
      const res = await fetch('/api/admin/documents/drive/organize/cleanup-empty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrl: url, markUnits }) })
      const j = await res.json()
      if (j.error || !j.ok) throw new Error(j.error ?? 'scan failed')
      setPlan({ emptyCount: j.emptyCount, foldersScanned: j.foldersScanned, sample: j.sample ?? [], deleteIds: j.deleteIds ?? [], tagPlan: j.tagPlan ?? [] })
    } catch (e) { alert(`Scan failed: ${(e as Error).message}`) } finally { setCleanupBusy(false) }
  }

  async function applyCleanup() {
    if (!plan) return
    const total = plan.deleteIds.length + plan.tagPlan.length
    if (!confirm(`Delete ${plan.deleteIds.length} empty subfolder(s)${plan.tagPlan.length ? ` and tag ${plan.tagPlan.length} unit folder(s)` : ''}? Unit folders and anything with files are kept.`)) return
    setCleanupBusy(true); setCleanupDone(null)
    let deleted = 0, tagged = 0, done = 0
    try {
      // Delete empty folders in chunks (each deleted as its owner, SA or PMI).
      const CHUNK = 40
      for (let i = 0; i < plan.deleteIds.length; i += CHUNK) {
        const ids = plan.deleteIds.slice(i, i + CHUNK)
        setProgress({ label: 'Deleting empty subfolders', done, total })
        const res = await fetch('/api/admin/documents/drive/organize/delete-folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
        const j = await res.json().catch(() => ({ deleted: 0 }))
        deleted += j.deleted ?? 0; done += ids.length
        setProgress({ label: 'Deleting empty subfolders', done, total })
      }
      // Apply the NO-FILES-YET tags (rename, one per call).
      for (const t of plan.tagPlan) {
        setProgress({ label: 'Tagging unit folders', done, total })
        const res = await fetch('/api/admin/documents/drive/organize/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: t.id, newName: t.newName }) })
        const j = await res.json().catch(() => ({})); if (j.ok) tagged++
        done++; setProgress({ label: 'Tagging unit folders', done, total })
      }
      setCleanupDone(`Deleted ${deleted} empty subfolder(s), tagged ${tagged} unit folder(s).`)
      setPlan(null)
    } catch (e) { alert(`Cleanup failed: ${(e as Error).message}`) } finally { setProgress(null); setCleanupBusy(false) }
  }

  const unitRef = useMemo(() => unitFromName(folderName), [folderName])

  // Core ops return success (no alerts) so Promote can batch them.
  async function doCopy(f: ScanFile, nameOverride?: string): Promise<boolean> {
    const newName = (nameOverride ?? names[f.id] ?? '').trim()
    if (!unitRef || !newName) return false
    const res = await fetch('/api/admin/documents/drive/organize/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, unitRef, newName }) })
    const j = await res.json().catch(() => ({})); if (!j.ok) return false
    setCopied(c => ({ ...c, [f.id]: true })); return true
  }
  async function doArchive(f: ScanFile): Promise<boolean> {
    if (!unitRef) return false
    const dateLabel = f.createdTime ? new Date(f.createdTime).toISOString().slice(0, 7) : undefined
    const res = await fetch('/api/admin/documents/drive/organize/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, unitRef, dateLabel }) })
    const j = await res.json().catch(() => ({})); if (!j.ok) return false
    setFiles(prev => (prev ?? []).filter(x => x.id !== f.id)); return true
  }

  async function copyToOfficial(f: ScanFile) {
    if (!unitRef || !(names[f.id] ?? '').trim()) { alert('Need a resolved unit + a name first.'); return }
    setRowBusy(b => ({ ...b, [f.id]: 'copy' }))
    if (!await doCopy(f)) alert('Copy to Official failed.')
    setRowBusy(b => ({ ...b, [f.id]: '' }))
  }
  async function archive(f: ScanFile) {
    if (!unitRef) { alert('No unit resolved for this folder.'); return }
    setRowBusy(b => ({ ...b, [f.id]: 'archive' }))
    if (!await doArchive(f)) alert('Archive failed.')
    setRowBusy(b => ({ ...b, [f.id]: '' }))
  }

  // One-click: copy every keeper (renamed) into Official, then move the whole
  // packet into the OLD archive — clearing On Going. Read-recognized keepers
  // (e.g. a Lauderhill cert) count too; ✦ Read those first.
  async function promoteApplication() {
    if (!unitRef) { alert('No unit # in the folder name — Promote needs it.'); return }
    const list = (files ?? []).slice()
    if (list.length === 0) return
    if (!confirm(`Promote ${unitRef}?\n\n• Keepers → copied to Official (renamed)\n• Whole packet → moved to OLD archive\n• On Going cleared`)) return
    setPromoting(true); setPromoteMsg(null)
    let copies = 0, moved = 0
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      setPromoteMsg(`${i + 1}/${list.length}…`)
      const rr = readRes[f.id]
      const readType = rr ? readTypeToken(rr) : null
      const isKeeper = (renamable(f) || !!readType) && !!(names[f.id] ?? '').trim()
      if (isKeeper && await doCopy(f)) copies++
      if (await doArchive(f)) moved++
    }
    setPromoting(false)
    setPromoteMsg(`Done — ${copies} keeper(s) copied to Official, ${moved} file(s) moved to OLD archive.`)
  }

  async function saveTenant(f: ScanFile) {
    const rr = readRes[f.id]
    const lease = rr?.lease
    if (!lease || !unitRef) return
    if (rr?.tenantOwnerMatch && !confirm(`⚠ "${lease.tenantNames.join(', ')}" matches the OWNER on file ("${rr.tenantOwnerMatch}"). Save this as the TENANT anyway?`)) return
    setRowBusy(b => ({ ...b, [f.id]: 'tenant' }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/save-tenant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ associationCode: readRes[f.id]?.associationCode ?? 'MANXI', unitRef, tenantName: lease.tenantNames.join(', '), leaseStart: lease.leaseStart, leaseEnd: lease.leaseEnd }) })
      const j = await res.json(); if (!j.ok) throw new Error(j.error ?? 'save failed')
      setSavedTenant(s => ({ ...s, [f.id]: true }))
    } catch (e) { alert(`Save tenant failed: ${(e as Error).message}`) } finally { setRowBusy(b => ({ ...b, [f.id]: '' })) }
  }

  async function readWithMaia(f: ScanFile) {
    setReading(r => ({ ...r, [f.id]: true }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, folderName, fileName: f.name }) })
      const j = (await res.json()) as ReadResult
      setReadRes(rr => ({ ...rr, [f.id]: j }))
      // If MAIA recognized a keeper type, offer a corrected name (works even
      // for files the filename-based filter marked "unrecognized"). An
      // insurance verdict is authoritative — it OVERRIDES a filename-based name
      // (so a liability-only binder named "HO6" becomes "Liability").
      const t = readTypeToken(j)
      if (t) {
        const ym = f.createdTime ? new Date(f.createdTime).toISOString().slice(0, 7).replace('-', '_') : null
        const e = f.name.match(/\.([a-z0-9]{1,5})$/i)?.[0] ?? ''
        const override = !!j.insurance   // insurance read wins over the filename type
        if (ym && (override || !names[f.id])) setNames(n => ({ ...n, [f.id]: `${ym}_${t}${e}` }))
      }
    } catch (e) { setReadRes(rr => ({ ...rr, [f.id]: { ok: false, error: (e as Error).message } })) }
    finally { setReading(r => ({ ...r, [f.id]: false })) }
  }

  async function requestHO6(f: ScanFile) {
    const r = readRes[f.id]
    if (!r?.insurance || !unitRef) return
    setRowBusy(b => ({ ...b, [f.id]: 'reqins' }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/request-insurance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ associationCode: r.associationCode ?? 'MANXI', unitRef, recommendation: r.insurance.recommendation, namedInsured: r.insurance.namedInsured }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'send failed')
      setRequestedIns(s => ({ ...s, [f.id]: `sent to ${j.sentTo}` }))
    } catch (e) { alert(`Could not email owner: ${(e as Error).message}`) } finally { setRowBusy(b => ({ ...b, [f.id]: '' })) }
  }

  async function fileToMaia(f: ScanFile) {
    const r = readRes[f.id]
    if (!r?.detected) return
    try {
      const res = await fetch('/api/admin/documents/drive/organize/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ associationCode: r.associationCode, unitRef: r.unitRef, itemKey: r.detected.itemKey, scope: r.detected.scope, expiry: r.detected.expirationDate, docType: r.detected.docType }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'file failed')
      setFiled(fl => ({ ...fl, [f.id]: true }))
    } catch (e) { alert(`Could not file: ${(e as Error).message}`) }
  }

  async function openBrowse(parentId = 'root') {
    setBrowseOpen(true); setBrowsing(true)
    try {
      const res = await fetch(`/api/admin/documents/drive/browse?parentId=${encodeURIComponent(parentId)}`)
      const j = await res.json()
      if (j.error) throw new Error(j.error)
      setBrowse(j)
    } catch (e) { setError((e as Error).message) } finally { setBrowsing(false) }
  }

  function chooseFolder(f: BrowseFolder) {
    setUrl(`https://drive.google.com/drive/folders/${f.id}`)
    setBrowseOpen(false)
    // scan it immediately
    setTimeout(() => scan(f.id), 0)
  }

  // Group by folder breadcrumb, and within each group propose + dedupe names.
  const groups = useMemo(() => {
    const m = new Map<string, ScanFile[]>()
    for (const f of files ?? []) { const k = f.path || '(top level)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(f) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [files])

  async function scan(overrideId?: string) {
    const folderUrl = overrideId ? `https://drive.google.com/drive/folders/${overrideId}` : url
    setScanning(true); setError(null); setFiles(null); setNames({}); setStatus({}); setRowErr({}); setFolderName(null); setFolderLink(null)
    try {
      const res = await fetch('/api/admin/documents/drive/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrl }) })
      const text = await res.text()
      let j: { files?: ScanFile[]; foldersScanned?: number; error?: string; folderName?: string | null; folderLink?: string | null }
      try { j = JSON.parse(text) } catch { throw new Error(res.status === 504 ? 'Scan timed out — try a smaller subfolder.' : `Scan failed (HTTP ${res.status}).`) }
      if (!res.ok) throw new Error(j.error ?? 'scan failed')
      const fs = (j.files ?? []) as ScanFile[]
      setFoldersScanned(Number(j.foldersScanned ?? 0))
      setFolderName(j.folderName ?? null); setFolderLink(j.folderLink ?? null)
      setFiles(fs)
      // Build suggested names, deduped within each folder.
      const byGroup = new Map<string, ScanFile[]>()
      for (const f of fs) { const k = f.path || '(top level)'; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k)!.push(f) }
      const next: Record<string, string> = {}
      for (const arr of byGroup.values()) {
        const suggestions = arr.map(f => proposeName(f.name, f.category, f.include, f.createdTime).suggested)
        const deduped = dedupeNames(suggestions)
        arr.forEach((f, i) => { if (deduped[i]) next[f.id] = deduped[i]! })
      }
      setNames(next)
      if (fs.length === 0) setError('No files found in that folder.')
    } catch (e) { setError((e as Error).message) } finally { setScanning(false) }
  }

  async function rename(f: ScanFile): Promise<boolean> {
    const newName = (names[f.id] ?? '').trim()
    if (!newName || newName === f.name) return false
    setStatus(s => ({ ...s, [f.id]: 'saving' })); setRowErr(e => ({ ...e, [f.id]: '' }))
    try {
      const res = await fetch('/api/admin/documents/drive/organize/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: f.id, newName }) })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'rename failed')
      setFiles(prev => (prev ?? []).map(x => x.id === f.id ? { ...x, name: newName } : x))
      setStatus(s => ({ ...s, [f.id]: 'done' }))
      return true
    } catch (e) { setStatus(s => ({ ...s, [f.id]: 'error' })); setRowErr(er => ({ ...er, [f.id]: (e as Error).message })); return false }
  }

  // Rename every file that has a proposed name (filename keepers + anything
  // MAIA read + recognized), with a progress bar.
  async function applyAll() {
    const targets = (files ?? []).filter(f => (names[f.id] ?? '').trim() && status[f.id] !== 'done')
    if (targets.length === 0) return
    setApplyingAll(true)
    for (let i = 0; i < targets.length; i++) { setBatch({ label: 'Renaming', done: i, total: targets.length }); await rename(targets[i]) }
    setBatch(null); setApplyingAll(false)
  }

  // Batch ✦ Read every file the filename didn't recognize, so the old
  // arbitrarily-named files in Official get identified + named for renaming.
  async function readAllUnrecognized() {
    const targets = (files ?? []).filter(f => !renamable(f) && !readRes[f.id])
    if (targets.length === 0) { alert('Nothing left to read.'); return }
    if (!confirm(`Have MAIA read ${targets.length} unrecognized file(s)? That's one AI call each.`)) return
    setApplyingAll(true)
    for (let i = 0; i < targets.length; i++) { setBatch({ label: 'Reading with MAIA', done: i, total: targets.length }); await readWithMaia(targets[i]) }
    setBatch(null); setApplyingAll(false)
  }

  function renamable(f: ScanFile): boolean {
    return f.include && !!TYPE_FOR_CATEGORY[f.category]
  }

  const renamableCount = (files ?? []).filter(f => (names[f.id] ?? '').trim()).length
  const unreadCount = (files ?? []).filter(f => !renamable(f) && !readRes[f.id]).length
  const doneCount = Object.values(status).filter(s => s === 'done').length

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a Drive folder link, or Browse →"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm" />
        <button onClick={() => openBrowse('root')} disabled={scanning} className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50">Browse Drive</button>
        <button onClick={() => scan()} disabled={scanning || !url.trim()} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{scanning ? 'Scanning…' : 'Scan'}</button>
      </div>
      {error && <div className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="mt-2 rounded border border-dashed border-gray-200 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-600">🧹 Empty subfolders</span>
          <button onClick={findCleanup} disabled={cleanupBusy || !url.trim()} className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 disabled:opacity-50">{cleanupBusy && !progress ? 'Scanning…' : 'Find empty'}</button>
          <label className="flex items-center gap-1 text-[11px] text-gray-600" title='Rename totally-empty unit folders to append "NO FILES YET" (auto-removed when a file is copied in)'>
            <input type="checkbox" checked={markUnits} onChange={e => setMarkUnits(e.target.checked)} /> tag empty units
          </label>
          {plan && !progress && (plan.deleteIds.length > 0 || plan.tagPlan.length > 0) && (
            <button onClick={applyCleanup} disabled={cleanupBusy} className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">Delete {plan.deleteIds.length} empty{plan.tagPlan.length ? ` + tag ${plan.tagPlan.length}` : ''}</button>
          )}
          {plan && !progress && <span className="text-[11px] text-gray-500">{plan.emptyCount} empty of {plan.foldersScanned} scanned{plan.emptyCount ? ` — e.g. ${plan.sample.slice(0, 4).join(', ')}${plan.emptyCount > 4 ? '…' : ''}` : ''} <span className="text-gray-400">(unit folders + anything with files are kept)</span></span>}
          {cleanupDone && <span className="text-[11px] font-medium text-emerald-700">{cleanupDone}</span>}
        </div>
        {progress && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[11px] text-gray-600"><span>{progress.label}…</span><span>{progress.done}/{progress.total} ({Math.round((progress.done / Math.max(1, progress.total)) * 100)}%)</span></div>
            <div className="h-2 w-full overflow-hidden rounded bg-gray-100"><div className="h-full bg-red-500 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-dashed border-gray-200 px-3 py-2">
        <span className="text-xs font-medium text-gray-600" title='Rename "Unit ###" folders → "MANXI### <year> <note>" and move files into year subfolders. Point at the OLD Approved Application Files folder.'>🗂 Reorganize OLD archive</span>
        <button onClick={planReorg} disabled={cleanupBusy || !url.trim()} className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 disabled:opacity-50">Plan reorg</button>
        {reorgPlan && !progress && (reorgPlan.counts.renames > 0 || reorgPlan.counts.moves > 0) && (
          <button onClick={applyReorg} disabled={cleanupBusy} className="rounded bg-[#0d9488] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">Rename {reorgPlan.counts.renames} + move {reorgPlan.counts.moves}</button>
        )}
        {reorgPlan && !progress && <span className="text-[11px] text-gray-500">{reorgPlan.counts.renames} folder(s), {reorgPlan.counts.moves} file(s){reorgPlan.counts.undated ? `, ${reorgPlan.counts.undated} no-year (left in place)` : ''}{reorgPlan.sampleRenames.length ? ` — e.g. ${reorgPlan.sampleRenames.slice(0, 2).join('; ')}` : ''}</span>}
        {reorgDone && <span className="text-[11px] font-medium text-emerald-700">{reorgDone}</span>}
      </div>

      <div className="mt-2 rounded border border-dashed border-gray-200 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-600" title="Rename each On Going 'Unit ###' folder → MANXI###, create a YYYY_MM_<first applicant> subfolder (from the lease/approval), and move + rename its files in.">📥 Organize On Going</span>
          <button onClick={planOngoing} disabled={ongoingBusy} className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 disabled:opacity-50">{ongoingBusy && !ongoingPlan && !progress ? 'Reading…' : 'Plan On Going'}</button>
          {ongoingPlan && !progress && (
            <button onClick={applyOngoing} disabled={ongoingBusy} className="rounded bg-[#c2410c] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">Apply all ({ongoingPlan.filter(u => u.newFolderName && (ongoingEdit[u.folderId] ?? u.subfolderName)).length})</button>
          )}
          {ongoingDone && <span className="text-[11px] font-medium text-emerald-700">{ongoingDone}</span>}
        </div>
        {ongoingPlan && !progress && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-gray-500"><th className="py-1 pr-3">Folder</th><th className="pr-3">Subfolder (YYYY_MM_First)</th><th className="pr-3">Files</th><th>Notes</th></tr></thead>
              <tbody>
                {ongoingPlan.map(u => (
                  <Fragment key={u.folderId}>
                    <tr className="border-t border-gray-100 align-top">
                      <td className="whitespace-nowrap py-1 pr-3"><span className="text-gray-400">{u.currentName}</span> → <b>{u.newFolderName ?? '—'}</b></td>
                      <td className="pr-3"><input value={ongoingEdit[u.folderId] ?? u.subfolderName ?? ''} onChange={e => setOngoingEdit(s => ({ ...s, [u.folderId]: e.target.value }))} placeholder="set manually" className="w-40 rounded border border-gray-300 px-1 py-0.5 text-[11px]" /></td>
                      <td className="pr-3 text-gray-600">
                        <button onClick={() => setOngoingOpen(o => ({ ...o, [u.folderId]: !o[u.folderId] }))} disabled={!u.files.length} className="underline decoration-dotted underline-offset-2 disabled:no-underline disabled:opacity-60">
                          {ongoingOpen[u.folderId] ? '▾ ' : '▸ '}{u.files.length} file(s){u.files.filter(f => f.newName !== f.currentName).length ? `, ${u.files.filter(f => f.newName !== f.currentName).length} renamed` : ''}
                        </button>
                      </td>
                      <td className="text-amber-700">{u.warnings.join(' ')}</td>
                    </tr>
                    {ongoingOpen[u.folderId] && u.files.length > 0 && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={4} className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {u.files.map(f => (
                              <div key={f.fileId} className="flex flex-wrap items-center gap-2">
                                {f.webViewLink
                                  ? <a href={f.webViewLink} target="_blank" rel="noreferrer" className="w-48 shrink-0 truncate text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700" title={`Open "${f.currentName}" in Drive`}>{f.currentName}</a>
                                  : <span className="w-48 shrink-0 truncate text-gray-500" title={f.currentName}>{f.currentName}</span>}
                                <span className="text-gray-400">→</span>
                                <input value={f.newName} onChange={e => setOngoingFileName(u.folderId, f.fileId, e.target.value)} className="w-52 rounded border border-gray-300 px-1 py-0.5 text-[11px]" />
                                {f.webViewLink && <a href={f.webViewLink} target="_blank" rel="noreferrer" className="shrink-0 rounded border border-blue-300 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50" title="Open the file in Drive to see what it is">↗ View</a>}
                                <button onClick={() => readOngoingFile(u.folderId, f)} disabled={reading[f.fileId]} className="shrink-0 rounded border border-[#f26a1b]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#c2410c] disabled:opacity-50" title="Have MAIA read this file and rename it by what it is">{reading[f.fileId] ? 'Reading…' : '✦ Read & name'}</button>
                                {f.newName !== f.currentName && <span className="text-[10px] text-emerald-600">✓</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-gray-400">Files move into the dated subfolder; keeper types get YYYY_MM_Type names (insurance stays generic — verify HO-6 vs liability separately). Nothing moves to OLD/Archive here — that happens on the board&apos;s final approval.</p>
          </div>
        )}
      </div>

      {browseOpen && (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold">📁 {browse?.current ? browse.current.name : 'My Drive'}</span>
              {browse?.current && (
                <button onClick={() => openBrowse(browse.current!.parentId ?? 'root')} className="text-blue-600 hover:underline">↑ up</button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {browse?.current && <button onClick={() => chooseFolder({ id: browse.current!.id, name: browse.current!.name })} className="text-xs font-medium text-[#c2410c] hover:underline">Scan this folder →</button>}
              <button onClick={() => setBrowseOpen(false)} className="text-xs text-gray-500 hover:underline">Close</button>
            </div>
          </div>
          {browsing ? <div className="py-3 text-center text-xs text-gray-400">Loading…</div> : (
            <div className="max-h-56 space-y-0.5 overflow-auto">
              {(browse?.folders ?? []).length === 0 && <div className="py-2 text-xs text-gray-400">No subfolders here.</div>}
              {(browse?.folders ?? []).map(f => (
                <div key={f.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-white">
                  <button onClick={() => openBrowse(f.id)} className="min-w-0 flex-1 truncate text-left text-gray-700">📁 {f.name}</button>
                  <button onClick={() => chooseFolder(f)} className="shrink-0 rounded bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-white">Scan</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {files && (folderName || files.length > 0) && (
        <div className="mt-4">
          {folderName && (
            <div className="mb-2 rounded bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
              Scanning <span className="font-semibold">📁 {folderName}</span>
              {folderLink && <a href={folderLink} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-600 hover:underline">open in Drive ↗</a>}
              {unitRef
                ? <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">unit {unitRef} → Official / Archive</span>
                : <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">no unit # in folder name — Copy/Archive need it</span>}
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">{files.length} file(s) across {foldersScanned} folder(s) · {renamableCount} named · {unreadCount} unrecognized · {doneCount} renamed</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && <button onClick={readAllUnrecognized} disabled={applyingAll} className="rounded border border-[#f26a1b]/40 px-3 py-1 text-xs font-medium text-[#c2410c] disabled:opacity-50" title="MAIA reads every file the filename didn't recognize (one AI call each)">{applyingAll && batch?.label.startsWith('Reading') ? 'Reading…' : `✦ Read all (${unreadCount})`}</button>}
              <button onClick={applyAll} disabled={applyingAll || renamableCount === 0} className="rounded bg-[#f26a1b] px-3 py-1 text-xs font-medium text-white hover:bg-[#d85a14] disabled:opacity-50">{applyingAll && batch?.label === 'Renaming' ? 'Renaming…' : `Rename all (${renamableCount})`}</button>
              <button onClick={promoteApplication} disabled={promoting || !unitRef || files.length === 0} title={unitRef ? 'Copy keepers to Official + move the packet to OLD archive' : 'No unit # in the folder name'} className="rounded bg-[#0d9488] px-3 py-1 text-xs font-medium text-white hover:bg-[#0f766e] disabled:opacity-50">{promoting ? 'Promoting…' : 'Promote application →'}</button>
            </div>
          </div>
          {batch && (
            <div className="mb-2">
              <div className="mb-1 flex justify-between text-[11px] text-gray-600"><span>{batch.label}…</span><span>{batch.done}/{batch.total} ({Math.round((batch.done / Math.max(1, batch.total)) * 100)}%)</span></div>
              <div className="h-2 w-full overflow-hidden rounded bg-gray-100"><div className="h-full bg-[#f26a1b] transition-all" style={{ width: `${Math.round((batch.done / Math.max(1, batch.total)) * 100)}%` }} /></div>
            </div>
          )}
          {promoteMsg && <div className="mb-2 rounded bg-teal-50 px-3 py-2 text-xs text-teal-800">{promoteMsg}</div>}

          <div className="space-y-4">
            {groups.map(([path, fs]) => (
              <div key={path}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{path}</div>
                <div className="space-y-1.5">
                  {fs.map(f => {
                    const rr = readRes[f.id]
                    const readType = rr ? readTypeToken(rr) : null
                    const canRename = renamable(f) || !!readType
                    const st = status[f.id] ?? 'idle'
                    return (
                      <div key={f.id} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs ${st === 'done' ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100'}`}>
                        <DocumentPreviewTrigger label="👁" previewUrl={`/api/admin/documents/drive/preview?fileId=${encodeURIComponent(f.id)}`} className="shrink-0 text-sm" />
                        {f.webViewLink && <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-blue-600 hover:underline" title="Open in Drive (for files too large to preview)">↗</a>}
                        <span className={`min-w-0 flex-1 truncate ${canRename ? 'text-gray-700' : 'text-gray-400'}`} title={f.name}>{f.name}</span>
                        {f.sourceMimeType && <span className="shrink-0 rounded bg-blue-50 px-1 text-[10px] text-blue-600">Doc→PDF</span>}
                        <button onClick={() => readWithMaia(f)} disabled={reading[f.id]} className="shrink-0 rounded border border-[#f26a1b]/40 px-1.5 py-0.5 text-[10px] font-medium text-[#c2410c] disabled:opacity-50" title="Have MAIA read the file contents (recognizes it + reads dates)">{reading[f.id] ? 'Reading…' : '✦ Read'}</button>
                        {canRename ? (
                          <>
                            <span className="shrink-0 text-gray-300">→</span>
                            <input value={names[f.id] ?? ''} onChange={e => setNames(n => ({ ...n, [f.id]: e.target.value }))}
                              className="w-52 shrink-0 rounded border border-gray-300 px-2 py-1 font-mono text-[11px]" />
                            {st === 'done'
                              ? <span className="shrink-0 text-emerald-600">✓ renamed</span>
                              : <button onClick={() => rename(f)} disabled={st === 'saving'} className="shrink-0 rounded bg-gray-800 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{st === 'saving' ? '…' : 'Apply'}</button>}
                            {copied[f.id]
                              ? <span className="shrink-0 text-emerald-600">✓ in Official</span>
                              : <button onClick={() => copyToOfficial(f)} disabled={!unitRef || rowBusy[f.id] === 'copy'} title={unitRef ? `Copy renamed into ${unitRef} (Official)` : 'No unit # resolved'} className="shrink-0 rounded bg-[#c2410c] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">{rowBusy[f.id] === 'copy' ? '…' : 'Copy → Official'}</button>}
                          </>
                        ) : (
                          <>
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500" title={f.reason}>
                              {f.category === 'approval' && f.sourceMimeType ? 'skip: unsigned draft' : `skip: ${CAT_LABEL[f.category] ?? f.category}`}
                            </span>
                            <button onClick={() => archive(f)} disabled={!unitRef || rowBusy[f.id] === 'archive'} title={unitRef ? `Move into OLD archive under ${unitRef}` : 'No unit # resolved'} className="shrink-0 rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 disabled:opacity-50">{rowBusy[f.id] === 'archive' ? '…' : 'Archive → OLD'}</button>
                          </>
                        )}
                        {st === 'error' && <span className="w-full text-[10px] text-red-600">{rowErr[f.id]}</span>}
                        {rr && (
                          <div className="w-full rounded bg-[#fff7ed] px-2 py-1 text-[11px] text-gray-700">
                            {rr.error && <span className="text-red-600">{rr.error}</span>}
                            {rr.detected && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span>MAIA read: <b>{rr.detected.docType ?? rr.detected.itemKey ?? 'document'}</b>{rr.detected.expirationDate ? <> · expires <b>{rr.detected.expirationDate}</b></> : (rr.detected.itemKey === 'unit.approval_letter' ? ' · expiry tracks the lease end' : ' · no expiry date')}{rr.unitRef ? ` · ${rr.unitRef}` : ''}</span>
                                {filed[f.id]
                                  ? <span className="text-emerald-600">✓ filed to MAIA</span>
                                  : <button onClick={() => fileToMaia(f)} className="rounded bg-[#c2410c] px-2 py-0.5 text-[10px] font-medium text-white">File to MAIA{rr.detected.expirationDate ? ' (save expiry)' : ''}</button>}
                              </div>
                            )}
                            {rr.lease && (
                              <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-orange-100 pt-1">
                                <span>Tenant: <b>{rr.lease.tenantNames.join(', ') || '—'}</b>{rr.lease.leaseStart || rr.lease.leaseEnd ? ` · lease ${rr.lease.leaseStart ?? '?'} → ${rr.lease.leaseEnd ?? '?'}` : ''}{rr.lease.monthlyRent ? ` · ${rr.lease.monthlyRent}` : ''}</span>
                                {rr.tenantOwnerMatch && <span className="w-full font-medium text-red-700">⚠ This name matches the OWNER on file (&ldquo;{rr.tenantOwnerMatch}&rdquo;) — confirm it&rsquo;s really the tenant before saving.</span>}
                                {savedTenant[f.id]
                                  ? <span className="text-emerald-600">✓ saved to tenant record</span>
                                  : <button onClick={() => saveTenant(f)} disabled={!unitRef || rowBusy[f.id] === 'tenant'} className="rounded bg-[#c2410c] px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50">{rowBusy[f.id] === 'tenant' ? '…' : 'Save tenant info'}</button>}
                              </div>
                            )}
                            {rr.insurance && (
                              <div className={`mt-1 border-t pt-1 ${rr.insurance.adequateForUnit ? 'border-orange-100' : 'border-red-200'}`}>
                                <div className={rr.insurance.adequateForUnit ? '' : 'font-medium text-red-700'}>
                                  Insurance: <b>{rr.insurance.policyType === 'ho6' ? 'HO-6 (unit owner)' : rr.insurance.policyType === 'ho4' ? 'HO-4 (renter)' : rr.insurance.policyType === 'liability_only' ? 'Liability-only — NOT a valid HO-6' : 'other'}</b>
                                  {rr.insurance.namedInsured ? ` · ${rr.insurance.namedInsured}${rr.insurance.insuredIsEntity ? ' (entity)' : ''}` : ''}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  coverage: {[rr.insurance.hasDwellingCoverage && 'dwelling', rr.insurance.hasPersonalProperty && 'contents', rr.insurance.hasLossAssessment && 'loss-assessment', rr.insurance.hasLiability && 'liability'].filter(Boolean).join(' · ') || 'none read'}
                                </div>
                                {!rr.insurance.adequateForUnit && rr.insurance.recommendation && <div className="text-[10px] text-red-600">→ {rr.insurance.recommendation}</div>}
                                {!rr.insurance.adequateForUnit && (
                                  <div className="mt-1">
                                    {requestedIns[f.id]
                                      ? <span className="text-[10px] text-emerald-600">✓ emailed owner ({requestedIns[f.id]}) · cc Jonathan + PMI</span>
                                      : <button onClick={() => requestHO6(f)} disabled={!unitRef || rowBusy[f.id] === 'reqins'} className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50">{rowBusy[f.id] === 'reqins' ? 'Sending…' : '✉ Email owner: request HO-6 (cc Jonathan + PMI)'}</button>}
                                  </div>
                                )}
                              </div>
                            )}
                            {!rr.detected && !rr.insurance && !rr.error && <span className="text-gray-500">MAIA couldn’t identify a compliance item in this file.</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">Types: {RENAME_TYPES.join(' · ')}. Edit any name before applying; insurance defaults to HO6 — change to HO4 for renter policies.</p>
        </div>
      )}
    </div>
  )
}
