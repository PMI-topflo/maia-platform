'use client'

// =====================================================================
// ComplianceOutreachClient.tsx
//   • Association list with Sent / Clicked / Resolved rollups → pick one.
//   • Per-association view: Preview (dry-run) what would be sent, Send the
//     batch, and a per-unit table with Sent / Clicked / ✅ Received chips.
//     Received units link to the uploaded document(s).
// Sends reuse the existing audit endpoint (/api/cron/owner-compliance-audit).
// =====================================================================

import { useCallback, useEffect, useState } from 'react'

// Always render timestamps in Eastern Time.
const ET = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'
  : '—'

type AssocSummary = { code: string; name: string; sent: number; clicked: number; resolved: number }
type ReceivedDoc = { id: string; filename: string | null; status: string }
type UnitRow = {
  unit_ref: string; label: string; email: string | null; missing: number
  status: 'received' | 'clicked' | 'sent' | 'not_sent'
  sentAt: string | null; sendCount: number; openedAt: string | null; received: ReceivedDoc[]
}
type Detail = { assoc: string; name: string; kind: string; rows: UnitRow[] }
type AuditResult = { scanned: number; needDocs: number; eligible: number; sent: number; dryRun: boolean }

export default function ComplianceOutreachClient() {
  const [assocs, setAssocs] = useState<AssocSummary[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/compliance/outreach').then(r => r.json()).then(d => setAssocs(d.associations ?? [])).catch(() => setAssocs([]))
  }, [])

  if (picked) return <AssociationView code={picked} onBack={() => setPicked(null)} />

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Pick an association to preview, send, and track its owner outreach.</p>
      {!assocs ? <Skeleton /> : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Association</th>
                <th className="px-4 py-2.5 font-medium text-center">Sent</th>
                <th className="px-4 py-2.5 font-medium text-center">Clicked</th>
                <th className="px-4 py-2.5 font-medium text-center">Resolved</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assocs.map(a => (
                <tr key={a.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5"><span className="font-medium text-gray-900">{a.name}</span> <span className="text-gray-400">({a.code})</span></td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{a.sent || '—'}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{a.clicked || '—'}</td>
                  <td className="px-4 py-2.5 text-center text-emerald-700">{a.resolved || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setPicked(a.code)} className="rounded bg-[#f26a1b] px-3 py-1 text-xs font-semibold text-white hover:bg-[#d85a10]">Open →</button>
                  </td>
                </tr>
              ))}
              {assocs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No associations.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AssociationView({ code, onBack }: { code: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState<null | 'preview' | 'send'>(null)
  const [result, setResult] = useState<AuditResult | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setDetail(null)
    fetch(`/api/admin/compliance/outreach?assoc=${encodeURIComponent(code)}`).then(r => r.json()).then(setDetail).catch(() => setErr('Could not load association.'))
  }, [code])
  useEffect(load, [load])

  const run = async (send: boolean) => {
    setBusy(send ? 'send' : 'preview'); setErr(null); setResult(null)
    try {
      const url = `/api/cron/owner-compliance-audit?assoc=${encodeURIComponent(code)}${send ? '&send=1' : ''}`
      const r = await fetch(url); const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'failed')
      setResult(d as AuditResult)
      if (send) { setConfirmSend(false); load() }   // refresh chips after a real send
    } catch (e) { setErr(e instanceof Error ? e.message : 'failed') } finally { setBusy(null) }
  }

  const counts = detail ? {
    received: detail.rows.filter(r => r.status === 'received').length,
    clicked: detail.rows.filter(r => r.status === 'clicked').length,
    sent: detail.rows.filter(r => r.status === 'sent').length,
    needs: detail.rows.filter(r => r.missing > 0).length,
  } : null

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm text-[#c2410c] hover:underline">← All associations</button>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{detail?.name ?? code} <span className="text-gray-400">({code})</span></h2>
          {counts && <p className="text-sm text-gray-500">{detail!.rows.length} units · {counts.needs} need documents · {counts.received} received · {counts.clicked} clicked · {counts.sent} sent (no click yet)</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => run(false)} disabled={!!busy} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy === 'preview' ? 'Checking…' : 'Preview (dry-run)'}
          </button>
          {confirmSend ? (
            <button onClick={() => run(true)} disabled={!!busy} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy === 'send' ? 'Sending…' : 'Confirm — send emails'}
            </button>
          ) : (
            <button onClick={() => { setConfirmSend(true); setResult(null) }} disabled={!!busy} className="rounded bg-[#f26a1b] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
              Send to this association
            </button>
          )}
        </div>
      </div>

      {confirmSend && !result && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This emails every owner with missing documents a link to their self-service page (max 4 reminders each, paced 14 days apart). Owners emailed in the last 14 days are skipped. Click <b>Confirm</b> to send, or run a Preview first.
        </p>
      )}
      {err && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {result && (
        <p className={`mb-3 rounded border px-3 py-2 text-sm ${result.dryRun ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {result.dryRun
            ? <>Dry-run: {result.scanned} scanned · {result.needDocs} need documents · <b>{result.eligible}</b> eligible to email now ({result.sent} would be sent this run).</>
            : <><b>Sent {result.sent}</b> email{result.sent === 1 ? '' : 's'} · {result.eligible} were eligible · {result.needDocs} need documents.</>}
        </p>
      )}

      {!detail ? <Skeleton /> : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Unit / Owner</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-center">Missing</th>
                <th className="px-4 py-2.5 font-medium">Last sent</th>
                <th className="px-4 py-2.5 font-medium">Documents received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.rows.map(r => (
                <tr key={r.unit_ref} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{r.label}</div>
                    <div className="text-xs text-gray-400">{r.email ?? <span className="text-amber-600">no email on file</span>}</div>
                  </td>
                  <td className="px-4 py-2.5"><StatusChip status={r.status} /></td>
                  <td className="px-4 py-2.5 text-center">{r.missing > 0 ? <span className="font-medium text-amber-700">{r.missing}</span> : <span className="text-emerald-600">0</span>}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">
                    {ET(r.sentAt)}{r.sendCount > 1 && <span className="text-gray-400"> ·{r.sendCount}×</span>}
                    {r.openedAt && <div className="text-emerald-600">clicked {ET(r.openedAt)}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.received.length === 0 ? <span className="text-gray-300">—</span> : (
                      <ul className="space-y-0.5">
                        {r.received.map(d => (
                          <li key={d.id}>
                            <a href={`/api/admin/documents/inbox/${d.id}`} target="_blank" rel="noreferrer" className="text-[#c2410c] hover:underline">
                              {d.filename ?? 'document'}
                            </a>
                            <span className="ml-1 text-xs text-gray-400">({d.status})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
              {detail.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No units found for this association.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: UnitRow['status'] }) {
  const map = {
    received: { c: 'bg-emerald-100 text-emerald-800', t: '✅ Received' },
    clicked: { c: 'bg-blue-100 text-blue-800', t: 'Clicked' },
    sent: { c: 'bg-gray-100 text-gray-700', t: 'Sent' },
    not_sent: { c: 'bg-gray-50 text-gray-400', t: 'Not sent' },
  }[status]
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${map.c}`}>{map.t}</span>
}

function Skeleton() {
  return <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>
}
