'use client'

// =====================================================================
// Leasing → Housekeeping. MAIA × Drive audit for one association: open
// applications that look dead (expire with one click, reopen if wrong),
// On Going Drive folders that are duplicates (merge), orphans (archive) or
// missing (create). User direction, 2026-09-14. Data + actions:
// lib/application-housekeeping.ts, /api/admin/applications-housekeeping.
// =====================================================================

import { useCallback, useEffect, useState } from 'react'
import type { Housekeeping, HousekeepingApp, HousekeepingFolder } from '@/lib/application-housekeeping'

const fmtD = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : '—'
const TYPE: Record<string, string> = { lease: 'Lease', lease_renewal: 'Renewal', purchase: 'Purchase', additional_occupant: 'Add. occupant' }

export default function HousekeepingPage() {
  const [assoc, setAssoc] = useState('MANXI')
  const [assocs, setAssocs] = useState<{ code: string; name: string }[]>([])
  const [data, setData] = useState<Housekeeping | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(true)

  const load = useCallback(async (code: string) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/applications-housekeeping?assoc=${encodeURIComponent(code)}`, { credentials: 'include', cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setData(j as Housekeeping)
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(assoc) }, [assoc, load])
  useEffect(() => {
    fetch('/api/admin/association-questions', { credentials: 'include' }).then(r => r.json())
      .then(j => setAssocs(((j.associations ?? []) as { association_code: string; association_name: string }[]).map(a => ({ code: a.association_code, name: a.association_name })))).catch(() => null)
  }, [])

  async function act(label: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(label); setMsg(null)
    try {
      const r = await fetch('/api/admin/applications-housekeeping', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(`${label}: done${j.moved != null ? ` (${j.moved} file(s) moved)` : ''}${j.driveMoved != null ? ` (${j.driveMoved} file(s) archived${j.driveError ? `; Drive: ${j.driveError}` : ''})` : ''}.`)
      await load(assoc)
    } catch (e) { setMsg(`${label}: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const expire = (a: HousekeepingApp) => {
    const reason = window.prompt(`Mark Unit ${a.unitLabel} (${a.applicants.join(', ') || 'no applicant'}) as EXPIRED?\n\nNo email goes out. The applicant links close, reminders stop, e-sign documents are voided and the Drive folder moves to the unit's Archive. You can reopen it later.\n\nReason on the record:`, a.flags[0] ? `${a.flags[0]} — closed during housekeeping` : 'Stale — closed during housekeeping')
    if (reason == null) return
    void act(`Expire ${a.unitLabel}`, { action: 'expire', applicationId: a.id, reason })
  }

  const apps = (data?.apps ?? []).filter(a => !onlyFlagged || a.flags.length > 0 || !a.driveFolderPresent)
  const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: '12px 14px', marginBottom: 14 }
  const h: React.CSSProperties = { font: '700 12px system-ui', letterSpacing: '.05em', textTransform: 'uppercase', color: '#6b7280', margin: '0 0 8px' }
  const btn = (primary = false): React.CSSProperties => ({ background: primary ? '#c0571a' : '#fff', color: primary ? '#fff' : '#374151', border: primary ? 0 : '1px solid #d1d5db', borderRadius: 7, padding: '5px 10px', font: '600 12px system-ui', cursor: 'pointer', whiteSpace: 'nowrap' })
  const link: React.CSSProperties = { color: '#2563eb', textDecoration: 'none', font: '600 12px system-ui' }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ font: '800 20px system-ui', color: '#1f2a44', margin: 0 }}>Applications housekeeping</h1>
        <select value={assoc} onChange={e => setAssoc(e.target.value)} style={{ font: '600 13px system-ui', padding: '5px 8px', borderRadius: 7, border: '1px solid #d1d5db' }}>
          {(assocs.length ? assocs : [{ code: 'MANXI', name: 'The Manors of Inverrary XI' }]).map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
        </select>
        <label style={{ font: '12.5px system-ui', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} /> Only rows that need attention</label>
        <button onClick={() => load(assoc)} disabled={loading} style={btn()}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <p style={{ font: '12.5px system-ui', color: '#6b7280', margin: '0 0 14px' }}>Open applications that look dead, and On Going Drive folders that are duplicated, orphaned or missing. Expire is silent (no email) and reversible with Reopen, which also brings the Drive files back. MAIA now expires dead applications on its own after an emailed notice (7 days with no file · 48 h unpaid fee · 7 days after 3 idle weeks · 7 days after the screening validity ends); the daily email lists them.</p>
      {err && <div style={{ ...box, borderColor: '#f3c9c3', background: '#fdf2f0', color: '#b42318' }}>{err}</div>}
      {msg && <div style={{ ...box, borderColor: msg.includes(': done') ? '#bbf7d0' : '#f3c9c3', background: msg.includes(': done') ? '#f0fdf4' : '#fdf2f0', color: msg.includes(': done') ? '#166534' : '#b42318', font: '13px system-ui' }}>{msg}</div>}

      {data && (
        <>
          <div style={box}>
            <div style={h}>Open applications · {data.apps.length} open · {data.apps.filter(a => a.suggestExpire).length} suggested to expire</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', font: '12.5px system-ui' }}>
                <thead><tr style={{ color: '#6b7280', textAlign: 'left' }}>
                  {['Unit', 'Type', 'Applicant(s)', 'Created', 'Idle', 'Docs', 'Stage', 'Lease on file ended', 'Drive folder', 'Why it needs attention', ''].map(c => <th key={c} style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{c}</th>)}
                </tr></thead>
                <tbody>
                  {apps.map(a => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9', background: a.suggestExpire ? '#fffbeb' : '#fff' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700 }}><a href={`/admin/pre-apply/${a.id}`} style={{ color: '#1f2a44', textDecoration: 'none' }}>{a.unitLabel ?? '—'}</a></td>
                      <td style={{ padding: '6px 8px' }}>{TYPE[a.type] ?? a.type}</td>
                      <td style={{ padding: '6px 8px' }}>{a.applicants.join(', ') || <span style={{ color: '#9ca3af' }}>no applicant</span>}</td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fmtD(a.createdAt)}</td>
                      <td style={{ padding: '6px 8px', color: a.idleDays >= 21 ? '#b42318' : '#374151', fontWeight: a.idleDays >= 21 ? 700 : 400 }}>{a.idleDays} d</td>
                      <td style={{ padding: '6px 8px' }}>{a.documents}</td>
                      <td style={{ padding: '6px 8px' }}>{a.stageLabel}</td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: (a.leaseEndedDaysAgo ?? 0) > 60 ? '#b42318' : '#374151' }}>{a.leaseEndOnFile ? `${fmtD(a.leaseEndOnFile)}${a.leaseEndedDaysAgo != null && a.leaseEndedDaysAgo > 0 ? ` (${a.leaseEndedDaysAgo} d ago)` : ''}` : '—'}</td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        {a.driveFolderPresent && a.driveFolderUrl ? <a href={a.driveFolderUrl} target="_blank" rel="noreferrer" style={link}>Open ↗</a>
                          : data.folders.ok ? <button disabled={!!busy} onClick={() => act(`Create folder ${a.unitLabel}`, { action: 'create_folder', applicationId: a.id })} style={btn()}>Create folder</button> : <span style={{ color: '#9ca3af' }}>?</span>}
                      </td>
                      <td style={{ padding: '6px 8px', color: '#92400e' }}>{a.notice && <span style={{ display: 'inline-block', font: '600 11px system-ui', color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 999, padding: '1px 8px', marginRight: 6 }}>notice sent · expires {fmtD(a.notice.dueAt)}</span>}{a.flags.join(' · ') || (!a.notice && <span style={{ color: '#9ca3af' }}>—</span>)}</td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        {(a.stage === 'applicant' || a.stage === 'refused' || a.documents === 0) && <button disabled={!!busy} onClick={() => expire(a)} style={btn(a.suggestExpire)}>{busy === `Expire ${a.unitLabel}` ? 'Closing…' : 'Mark expired'}</button>}
                        {a.notice?.kind === 'unpaid' && <button disabled={!!busy} onClick={() => act(`Screened elsewhere ${a.unitLabel}`, { action: 'screened_elsewhere', applicationId: a.id }, `Record that Unit ${a.unitLabel} paid / was screened outside MAIA (e.g. Tenant Evaluation)? The unpaid-fee notice is cancelled and MAIA will not ask for the fee.`)} style={{ ...btn(), marginLeft: 6 }}>Paid elsewhere</button>}
                      </td>
                    </tr>
                  ))}
                  {apps.length === 0 && <tr><td colSpan={11} style={{ padding: 10, color: '#9ca3af' }}>Nothing needs attention.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div style={box}>
            <div style={h}>Drive · On Going Applications {data.folders.ongoingRootUrl && <a href={data.folders.ongoingRootUrl} target="_blank" rel="noreferrer" style={link}>open ↗</a>}</div>
            {!data.folders.ok && <div style={{ color: '#b42318', font: '12.5px system-ui' }}>Drive could not be read: {data.folders.error}</div>}
            {data.folders.ok && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div style={{ font: '600 12.5px system-ui', color: '#1c2333', marginBottom: 4 }}>Duplicate folders · {data.folders.duplicates.length}</div>
                  {data.folders.duplicates.length === 0 && <div style={{ font: '12.5px system-ui', color: '#9ca3af' }}>None.</div>}
                  {data.folders.duplicates.map(g => {
                    const keep = g.folders[0]
                    return (
                      <div key={g.unitRef} style={{ font: '12.5px system-ui', padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
                        <b>{g.unitRef}</b> — keep <a href={keep.url} target="_blank" rel="noreferrer" style={link}>{keep.name}</a> ({keep.fileCount} files)
                        {g.folders.slice(1).map(f => (
                          <span key={f.id} style={{ marginLeft: 10 }}>
                            merge <a href={f.url} target="_blank" rel="noreferrer" style={link}>{f.name}</a> ({f.fileCount} files) into it
                            <button disabled={!!busy} onClick={() => act(`Merge ${g.unitRef}`, { action: 'merge_folders', survivorFolderId: keep.id, loserFolderId: f.id }, `Move ${f.fileCount} file(s) from "${f.name}" into "${keep.name}" and trash the empty folder?`)} style={{ ...btn(true), marginLeft: 6 }}>Merge</button>
                          </span>
                        ))}
                      </div>
                    )
                  })}
                </div>
                <div>
                  <div style={{ font: '600 12.5px system-ui', color: '#1c2333', marginBottom: 4 }}>Folders with no open application · {data.folders.orphans.length}</div>
                  {data.folders.orphans.length === 0 && <div style={{ font: '12.5px system-ui', color: '#9ca3af' }}>None.</div>}
                  {data.folders.orphans.map((f: HousekeepingFolder) => (
                    <div key={f.id} style={{ font: '12.5px system-ui', padding: '6px 0', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <a href={f.url} target="_blank" rel="noreferrer" style={link}>{f.name}</a> <span style={{ color: '#6b7280' }}>{f.fileCount} files · created {fmtD(f.createdAt)}</span>
                      <button disabled={!!busy} onClick={() => act(`Archive ${f.name}`, { action: 'archive_folder', assoc: data.associationCode, unitLabel: f.unitRef?.replace(data.associationCode, '') ?? '', folderId: f.id }, `Move the ${f.fileCount} file(s) of "${f.name}" to the unit's OLD/Archive folder and trash the empty folder?`)} style={btn()}>Move to Archive</button>
                    </div>
                  ))}
                </div>
                {data.folders.unparsed.length > 0 && (
                  <div>
                    <div style={{ font: '600 12.5px system-ui', color: '#1c2333', marginBottom: 4 }}>Folders MAIA cannot match to a unit · {data.folders.unparsed.length}</div>
                    {data.folders.unparsed.map(f => <div key={f.id} style={{ font: '12.5px system-ui', padding: '4px 0' }}><a href={f.url} target="_blank" rel="noreferrer" style={link}>{f.name}</a> <span style={{ color: '#6b7280' }}>{f.fileCount} files</span> — rename it to start with the unit account (e.g. {data.associationCode}###)</div>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {data.recentlyClosed.length > 0 && (
            <div style={box}>
              <div style={h}>Recently withdrawn or expired</div>
              {data.recentlyClosed.map(c => (
                <div key={c.id} style={{ font: '12.5px system-ui', padding: '5px 0', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <a href={`/admin/pre-apply/${c.id}`} style={{ ...link, color: '#1f2a44' }}>Unit {c.unitLabel ?? '—'}</a>
                  <span style={{ font: '600 11px system-ui', color: '#374151', background: '#e5e7eb', borderRadius: 999, padding: '2px 8px' }}>{c.status}</span>
                  <span style={{ color: '#6b7280' }}>{fmtD(c.at)} · {c.reason ?? ''}</span>
                  <button disabled={!!busy} onClick={() => act(`Reopen ${c.unitLabel}`, { action: 'reopen', applicationId: c.id }, `Reopen Unit ${c.unitLabel}? It goes back to its previous status; the Drive files stay in the Archive.`)} style={btn()}>Reopen</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
