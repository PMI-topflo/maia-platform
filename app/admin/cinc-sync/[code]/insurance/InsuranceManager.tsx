'use client'

// =====================================================================
// /admin/cinc-sync/[code]/insurance/InsuranceManager.tsx
//
// Renders the full Florida HOA/condo master-insurance checklist. Each
// coverage in POLICY_TYPES gets a card showing its current status
// (current / expiring / expired / missing / waived) plus the recorded
// policy details and COI. Staff can add a policy, record a renewal,
// edit details in place, waive a coverage that doesn't apply, or view
// superseded versions.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  POLICY_TYPES,
  policyStatus,
  type AssociationInsurancePolicy,
  type PolicyStatus,
  type RequirementTier,
} from '@/lib/association-insurance'
import { normalizeUploadFile } from '@/lib/normalize-upload-client'

interface Props { assocCode: string }

// ─── status + tier presentation ──────────────────────────────────────
const STATUS_BADGE: Record<PolicyStatus, { label: string; cls: string }> = {
  current:     { label: '✓ Current',   cls: 'bg-green-600 text-white' },
  expiring:    { label: 'Expiring',    cls: 'bg-amber-500 text-white' },
  expired:     { label: 'Expired',     cls: 'bg-red-600 text-white' },
  no_expiry:   { label: 'No expiry',   cls: 'bg-gray-400 text-white' },
  waived:      { label: 'Waived',      cls: 'bg-gray-300 text-gray-700' },
  missing:     { label: 'Missing',     cls: 'bg-red-100 text-red-700 border border-red-300' },
  not_tracked: { label: 'Not on file', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
}

const TIER_BADGE: Record<RequirementTier, { label: string; cls: string }> = {
  required:    { label: 'Required',    cls: 'bg-red-50 text-red-700 border border-red-200' },
  conditional: { label: 'Conditional', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  recommended: { label: 'Recommended', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
}

function money(n: number | null): string {
  if (n === null || n === undefined) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function InsuranceManager({ assocCode }: Props) {
  const [policies, setPolicies] = useState<AssociationInsurancePolicy[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Which policy_type card has its editor open, and in which mode.
  const [editing, setEditing] = useState<{ type: string; mode: 'edit' | 'create' } | null>(null)
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/admin/associations/${assocCode}/insurance?include_archived=1`)
      .then(r => r.ok ? r.json() : r.json().then(b => { throw new Error(b?.error ?? 'load failed') }))
      .then(data => { if (!cancelled) setPolicies(data.policies ?? []) })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [assocCode, reloadKey])

  function refresh() { setReloadKey(k => k + 1); setEditing(null) }

  // active (current) row per policy_type + the archived history list.
  const { activeByType, historyByType } = useMemo(() => {
    const active = new Map<string, AssociationInsurancePolicy>()
    const history = new Map<string, AssociationInsurancePolicy[]>()
    for (const p of policies) {
      if (!p.archived_at) {
        active.set(p.policy_type, p)
      } else {
        const arr = history.get(p.policy_type) ?? []
        arr.push(p)
        history.set(p.policy_type, arr)
      }
    }
    return { activeByType: active, historyByType: history }
  }, [policies])

  // Summary: how many tracked coverages need attention.
  const summary = useMemo(() => {
    let attention = 0, onFile = 0, waived = 0, missing = 0
    for (const def of POLICY_TYPES) {
      const st = policyStatus(def.tier, activeByType.get(def.key) ?? null)
      if (st === 'waived') waived++
      else if (st === 'missing') { missing++; attention++ }
      else if (st === 'expired' || st === 'expiring') { onFile++; attention++ }
      else if (st === 'current' || st === 'no_expiry') onFile++
    }
    return { attention, onFile, waived, missing }
  }, [activeByType])

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className={[
        'rounded-lg border px-4 py-3 text-sm flex items-center justify-between flex-wrap gap-2',
        summary.attention > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800',
      ].join(' ')}>
        <div className="font-medium">
          {summary.attention > 0
            ? `⚠ ${summary.attention} coverage${summary.attention === 1 ? '' : 's'} need attention`
            : '✓ All tracked coverages are current'}
        </div>
        <div className="text-xs font-mono text-gray-600">
          {summary.onFile} on file · {summary.missing} missing · {summary.waived} waived · {POLICY_TYPES.length} total
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading policies…</div>}

      {!loading && POLICY_TYPES.map(def => {
        const active = activeByType.get(def.key) ?? null
        const status = policyStatus(def.tier, active)
        const history = historyByType.get(def.key) ?? []
        const isEditing = editing?.type === def.key
        const histOpen = !!showHistory[def.key]

        return (
          <section key={def.key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
                    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-mono font-semibold uppercase ${TIER_BADGE[def.tier].cls}`}>
                      {TIER_BADGE[def.tier].label}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase ${STATUS_BADGE[status].cls}`}>
                      {STATUS_BADGE[status].label}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug max-w-2xl">
                    {def.description}
                    {def.condition && <span className="block mt-0.5 text-amber-700">⚑ {def.condition}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {active && !active.waived && (
                    <button
                      onClick={() => setEditing(isEditing && editing?.mode === 'edit' ? null : { type: def.key, mode: 'edit' })}
                      className="text-[10px] font-mono uppercase text-gray-500 hover:text-[#f26a1b] px-2 py-1 rounded border border-gray-200 hover:border-[#f26a1b]"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(isEditing && editing?.mode === 'create' ? null : { type: def.key, mode: 'create' })}
                    className="text-[10px] font-mono uppercase text-[#f26a1b] hover:text-white hover:bg-[#f26a1b] px-2 py-1 rounded border border-[#f26a1b] transition-colors"
                  >
                    {active && !active.waived ? 'Record renewal' : active?.waived ? 'Add policy' : '+ Add policy'}
                  </button>
                </div>
              </div>

              {/* Current policy details */}
              {active && !active.waived && (
                <PolicyDetails policy={active} assocCode={assocCode} onChanged={refresh} />
              )}
              {active?.waived && (
                <div className="mt-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  Waived{active.waived_reason ? `: ${active.waived_reason}` : ''}.
                  {' '}
                  <button onClick={() => unwaive(assocCode, active.id, refresh)} className="text-[#f26a1b] hover:underline font-mono uppercase text-[10px]">
                    Un-waive
                  </button>
                </div>
              )}
              {!active && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">Nothing on file.</span>
                  <button
                    onClick={() => waive(assocCode, def.key, refresh)}
                    className="text-[10px] font-mono uppercase text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded border border-gray-200"
                  >
                    Waive (not applicable)
                  </button>
                </div>
              )}
            </div>

            {/* Inline editor */}
            {isEditing && (
              <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3">
                <PolicyEditor
                  assocCode={assocCode}
                  policyType={def.key}
                  existing={editing?.mode === 'edit' ? active : null}
                  onSaved={refresh}
                  onCancel={() => setEditing(null)}
                />
              </div>
            )}

            {/* History */}
            {history.length > 0 && (
              <div className="border-t border-gray-100 bg-gray-50/40">
                <button
                  onClick={() => setShowHistory(p => ({ ...p, [def.key]: !histOpen }))}
                  className="w-full px-4 py-2 text-[11px] font-mono uppercase tracking-wide text-gray-500 hover:text-gray-800 text-left"
                >
                  {histOpen ? '▾' : '▸'} {history.length} previous version{history.length === 1 ? '' : 's'}
                </button>
                {histOpen && (
                  <ul className="divide-y divide-gray-100">
                    {history.map(h => (
                      <li key={h.id} className="px-4 py-2 text-[11px] text-gray-500 flex items-center justify-between gap-2">
                        <span>
                          {h.carrier ?? 'carrier unknown'}
                          {h.policy_number ? ` · #${h.policy_number}` : ''}
                          {h.expiration_date ? ` · expired ${h.expiration_date}` : ''}
                        </span>
                        <span className="font-mono text-gray-400">archived {h.archived_at?.slice(0, 10)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

// ─── quick actions ────────────────────────────────────────────────────
async function waive(assocCode: string, policyType: string, onDone: () => void) {
  const reason = prompt('Why is this coverage not applicable? (e.g. "No building in a flood zone")')
  if (reason === null) return
  const res = await fetch(`/api/admin/associations/${assocCode}/insurance`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ policy_type: policyType, waived: true, waived_reason: reason }),
  })
  if (!res.ok) { const d = await res.json().catch(() => ({})); alert(`Waive failed: ${d?.error ?? res.status}`); return }
  onDone()
}

async function unwaive(assocCode: string, id: number, onDone: () => void) {
  const res = await fetch(`/api/admin/associations/${assocCode}/insurance/${id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ waived: false, waived_reason: null }),
  })
  if (!res.ok) { const d = await res.json().catch(() => ({})); alert(`Un-waive failed: ${d?.error ?? res.status}`); return }
  onDone()
}

// ─── current policy detail block ──────────────────────────────────────
function PolicyDetails({ policy, assocCode, onChanged }: {
  policy: AssociationInsurancePolicy; assocCode: string; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function openCoi() {
    const res = await fetch(`/api/admin/associations/${assocCode}/insurance/${policy.id}`)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(`Open failed: ${d?.error ?? res.status}`); return }
    const data = await res.json()
    if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer')
  }

  async function onArchive() {
    if (!confirm(`Archive this ${policy.carrier ?? ''} policy? It moves to "Previous versions".`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/associations/${assocCode}/insurance/${policy.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }),
    })
    setBusy(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(`Archive failed: ${d?.error ?? res.status}`); return }
    onChanged()
  }

  const fields: Array<[string, string]> = [
    ['Carrier',       policy.carrier ?? '—'],
    ['Policy #',      policy.policy_number ?? '—'],
    ['Named insured', policy.named_insured ?? '—'],
    ['Effective',     policy.effective_date ?? '—'],
    ['Expires',       policy.expiration_date ?? '—'],
    ['Coverage',      money(policy.coverage_amount_usd) || '—'],
    ['Premium',       money(policy.premium_usd) || '—'],
  ]

  return (
    <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-3">
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-[11px]">
        {fields.map(([k, v]) => (
          <div key={k}>
            <dt className="text-gray-400 font-mono uppercase tracking-wide text-[9px]">{k}</dt>
            <dd className="text-gray-800">{v}</dd>
          </div>
        ))}
      </dl>
      {(policy.agent_name || policy.agent_email || policy.agent_phone) && (
        <div className="mt-2 text-[11px] text-gray-500">
          Agent: {policy.agent_name ?? '—'}
          {policy.agent_email ? ` · ${policy.agent_email}` : ''}
          {policy.agent_phone ? ` · ${policy.agent_phone}` : ''}
        </div>
      )}
      {policy.notes && <div className="mt-1 text-[11px] text-gray-500">{policy.notes}</div>}
      <div className="mt-2 flex items-center gap-3">
        {policy.coi_storage_path
          ? <button onClick={openCoi} className="text-[11px] font-mono text-[#f26a1b] hover:underline">📦 {policy.coi_filename ?? 'View COI'} <span className="text-gray-400">(in system)</span></button>
          : policy.drive_url
            ? <button onClick={openCoi} className="text-[11px] font-mono text-[#f26a1b] hover:underline">🗂 View COI <span className="text-gray-400">(Drive)</span></button>
            : <span className="text-[11px] text-amber-600 font-mono">No COI on file</span>}
        <button onClick={onArchive} disabled={busy} className="text-[10px] font-mono uppercase text-gray-400 hover:text-amber-700 ml-auto">
          {busy ? '…' : 'Archive'}
        </button>
      </div>
    </div>
  )
}

// ─── add / edit form ──────────────────────────────────────────────────
function PolicyEditor({ assocCode, policyType, existing, onSaved, onCancel }: {
  assocCode:  string
  policyType: string
  existing:   AssociationInsurancePolicy | null   // null = create new version
  onSaved:    () => void
  onCancel:   () => void
}) {
  const [carrier, setCarrier]         = useState(existing?.carrier ?? '')
  const [policyNumber, setPolicyNumber] = useState(existing?.policy_number ?? '')
  const [namedInsured, setNamedInsured] = useState(existing?.named_insured ?? '')
  const [effective, setEffective]     = useState(existing?.effective_date ?? '')
  const [expiration, setExpiration]   = useState(existing?.expiration_date ?? '')
  const [coverage, setCoverage]       = useState(existing?.coverage_amount_usd?.toString() ?? '')
  const [premium, setPremium]         = useState(existing?.premium_usd?.toString() ?? '')
  const [agentName, setAgentName]     = useState(existing?.agent_name ?? '')
  const [agentEmail, setAgentEmail]   = useState(existing?.agent_email ?? '')
  const [agentPhone, setAgentPhone]   = useState(existing?.agent_phone ?? '')
  const [notes, setNotes]             = useState(existing?.notes ?? '')
  const [driveUrl, setDriveUrl]       = useState(existing?.drive_url ?? '')
  const [file, setFile]               = useState<File | null>(null)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadCoi(): Promise<{ coi_storage_path: string; coi_filename: string; coi_mime_type: string; coi_file_size_bytes: number } | null> {
    if (!file) return null
    // Shrink oversized scans in the browser before this server-bypassing upload.
    const upFile = await normalizeUploadFile(file)
    const urlRes = await fetch(`/api/admin/associations/${assocCode}/insurance/upload-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, policy_type: policyType }),
    })
    const urlData = await urlRes.json()
    if (!urlRes.ok) throw new Error(urlData?.error ?? 'Could not get upload URL')
    const put = await fetch(urlData.signed_url, {
      method: 'PUT', body: upFile,
      headers: { 'Content-Type': upFile.type || 'application/pdf', 'x-upsert': 'false' },
    })
    if (!put.ok) {
      let detail = `HTTP ${put.status}`
      try { const j = await put.json() as { message?: string; error?: string }; detail = j?.message ?? j?.error ?? detail } catch {}
      throw new Error(`COI upload failed: ${detail}`)
    }
    return {
      coi_storage_path:    urlData.storage_path,
      coi_filename:        file.name,
      coi_mime_type:       upFile.type || 'application/pdf',
      coi_file_size_bytes: upFile.size,
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const coi = await uploadCoi()
      const payload: Record<string, unknown> = {
        carrier, policy_number: policyNumber, named_insured: namedInsured,
        effective_date: effective || null, expiration_date: expiration || null,
        coverage_amount_usd: coverage || null, premium_usd: premium || null,
        agent_name: agentName, agent_email: agentEmail, agent_phone: agentPhone,
        notes,
        drive_url: driveUrl || null,
        ...(coi ?? {}),
      }

      let res: Response
      if (existing) {
        // Edit in place — PATCH only the fields shown.
        res = await fetch(`/api/admin/associations/${assocCode}/insurance/${existing.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      } else {
        // New version (renewal / first policy) — POST archives the prior.
        res = await fetch(`/api/admin/associations/${assocCode}/insurance`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policy_type: policyType, ...payload }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-[#f26a1b] bg-white'
  const lblCls   = 'text-[10px] font-mono uppercase tracking-wide text-gray-600'

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="text-[11px] text-gray-500 font-mono uppercase">
        {existing ? 'Edit current policy details' : 'Record a new policy / renewal'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block"><span className={lblCls}>Carrier</span>
          <input value={carrier} onChange={e => setCarrier(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Policy #</span>
          <input value={policyNumber} onChange={e => setPolicyNumber(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Named insured</span>
          <input value={namedInsured} onChange={e => setNamedInsured(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Effective date</span>
          <input type="date" value={effective} onChange={e => setEffective(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Expiration date</span>
          <input type="date" value={expiration} onChange={e => setExpiration(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Coverage amount (USD)</span>
          <input inputMode="numeric" value={coverage} onChange={e => setCoverage(e.target.value)} disabled={busy} placeholder="e.g. 5000000" className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Annual premium (USD)</span>
          <input inputMode="numeric" value={premium} onChange={e => setPremium(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Agent / broker</span>
          <input value={agentName} onChange={e => setAgentName(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Agent email</span>
          <input type="email" value={agentEmail} onChange={e => setAgentEmail(e.target.value)} disabled={busy} className={inputCls} /></label>
        <label className="block"><span className={lblCls}>Agent phone</span>
          <input value={agentPhone} onChange={e => setAgentPhone(e.target.value)} disabled={busy} className={inputCls} /></label>
      </div>
      <label className="block"><span className={lblCls}>Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} rows={2} className={inputCls} /></label>

      <div>
        <span className={lblCls}>Certificate of Insurance (PDF)</span>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf"
          onChange={e => setFile(e.target.files?.[0] ?? null)} disabled={busy}
          className="mt-1 block text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-mono file:uppercase file:bg-[#f26a1b]/10 file:text-[#f26a1b] hover:file:bg-[#f26a1b]/20" />
        {existing?.coi_storage_path && !file && (
          <span className="text-[10px] text-gray-400 block mt-1">Current COI: {existing.coi_filename ?? 'on file'} — choose a file to replace it.</span>
        )}
      </div>

      <label className="block">
        <span className={lblCls}>…or Google Drive link</span>
        <input value={driveUrl} onChange={e => setDriveUrl(e.target.value)} disabled={busy}
          placeholder="https://drive.google.com/…  (paste instead of uploading; update anytime)"
          className={inputCls} />
        <span className="text-[10px] text-gray-500 block mt-0.5">
          Use this when the COI stays in Drive. The uploaded file takes priority if both are set.
        </span>
      </label>

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs font-mono uppercase text-gray-500 hover:text-gray-800 px-3 py-1.5">Cancel</button>
        <button type="submit" disabled={busy}
          className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-xs font-semibold uppercase tracking-wide px-4 py-1.5 rounded [font-family:var(--font-mono)]">
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save policy'}
        </button>
      </div>
    </form>
  )
}
