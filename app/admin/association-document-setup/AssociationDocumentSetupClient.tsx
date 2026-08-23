'use client'

import { useEffect, useMemo, useState } from 'react'

interface Requirement {
  id: string; association_code: string; item_key: string; label: string
  occupancy_filter: string | null; active: boolean; created_at: string
}

interface AssocQuestions {
  association_code: string; association_name: string
  pets_allowed: boolean | null; requires_interview_lease: boolean; requires_interview_purchase: boolean
}

// occupancy_filter value -> section (null/'' means "always required").
const SECTIONS: { key: string | null; title: string; blurb: string }[] = [
  { key: null, title: 'Always required', blurb: 'Asked on every application for this association, regardless of occupancy.' },
  { key: 'owner_occupied', title: 'Only when owner-occupied', blurb: 'Only asked when the unit is the owner’s primary residence.' },
  { key: 'leased', title: 'Only when leased', blurb: 'Only asked when the unit is rented out to a tenant.' },
  { key: 'vacant', title: 'Only when vacant', blurb: 'Only asked when nobody currently occupies the unit.' },
]

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-2.5 text-left disabled:opacity-50">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors ${checked ? 'bg-[#f26a1b]' : 'bg-gray-300'}`}>
        <span className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5.5' : 'translate-x-1'}`} style={{ height: 18, width: 18 }} />
      </span>
    </button>
  )
}

function AssociationQuestions({ assoc, questions, onSaved }: { assoc: string; questions: AssocQuestions[] | null; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const row = (questions ?? []).find(q => q.association_code === assoc)
  if (!row) return null

  async function save(field: 'pets_allowed' | 'requires_interview_lease' | 'requires_interview_purchase', value: boolean) {
    setBusy(field); setMsg(null)
    try {
      const res = await fetch('/api/admin/association-questions', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ associationCode: assoc, [field]: value }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      onSaved()
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Association questions</div>
      <p className="text-xs text-gray-400 mb-1">General answers about {assoc} that shape how MAIA runs applications here — not tied to any one document.</p>
      {msg && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 my-2">{msg}</div>}
      <div className="divide-y divide-gray-100">
        <Toggle label="Is the association pet friendly?" checked={row.pets_allowed !== false} disabled={busy === 'pets_allowed'}
          onChange={v => save('pets_allowed', v)} />
        <Toggle label="Does it require an interview before approving leases?" checked={row.requires_interview_lease} disabled={busy === 'requires_interview_lease'}
          onChange={v => save('requires_interview_lease', v)} />
        <Toggle label="Does it require an interview before approving purchases?" checked={row.requires_interview_purchase} disabled={busy === 'requires_interview_purchase'}
          onChange={v => save('requires_interview_purchase', v)} />
      </div>
      {(row.requires_interview_lease || row.requires_interview_purchase) && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-2">
          When the board hits Approve on {[row.requires_interview_lease && 'a lease', row.requires_interview_purchase && 'a purchase'].filter(Boolean).join(' or ')} here, MAIA holds the approval letter and instead emails the applicant (board CC&apos;d) to introduce them and schedule an interview. Staff mark it complete on the application page to release the letter.
        </p>
      )}
    </div>
  )
}

export default function AssociationDocumentSetupBody({ assoc }: { assoc: string }) {
  const [reqs, setReqs] = useState<Requirement[] | null>(null)
  const [questions, setQuestions] = useState<AssocQuestions[] | null>(null)
  const [label, setLabel] = useState('')
  const [occFilter, setOccFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = () => {
    fetch('/api/admin/association-document-requirements?all=true').then(r => r.json()).then(d => setReqs(d.requirements ?? [])).catch(() => setReqs([]))
  }
  const loadQuestions = () => {
    fetch('/api/admin/association-questions').then(r => r.json()).then(d => setQuestions(d.associations ?? [])).catch(() => setQuestions([]))
  }
  useEffect(load, [])
  useEffect(loadQuestions, [])

  const forAssoc = useMemo(() => (reqs ?? []).filter(r => r.association_code === assoc), [reqs, assoc])
  const bySection = useMemo(() => {
    const m = new Map<string | null, Requirement[]>(SECTIONS.map(s => [s.key, []]))
    for (const r of forAssoc) {
      const key = r.occupancy_filter && SECTIONS.some(s => s.key === r.occupancy_filter) ? r.occupancy_filter : null
      m.get(key)!.push(r)
    }
    return m
  }, [forAssoc])

  async function add() {
    if (!assoc || !label.trim()) { setMsg({ kind: 'err', text: 'Pick an association and enter a label.' }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/association-document-requirements', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ associationCode: assoc, label: label.trim(), occupancyFilter: occFilter }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setLabel(''); setOccFilter(null); load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function toggleActive(r: Requirement) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/association-document-requirements/${r.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: !r.active }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function remove(r: Requirement) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/association-document-requirements/${r.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  const inputCls = 'rounded border border-gray-300 px-3 py-2 text-sm'

  return (
    <div className="space-y-4">
      <AssociationQuestions assoc={assoc} questions={questions} onSaved={loadQuestions} />

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Add a document requirement for {assoc}</div>
        <div className="flex flex-wrap gap-2">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. City of Lauderhill Certificate of Use"
            className={inputCls + ' flex-1 min-w-[240px]'} />
          <button onClick={add} disabled={busy} className="rounded bg-[#f26a1b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
            Add
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {SECTIONS.map(s => (
            <button key={s.key ?? 'always'} type="button" onClick={() => setOccFilter(s.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium border ${occFilter === s.key ? 'bg-[#1f2a44] text-white border-[#1f2a44]' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {msg && <div className={`rounded border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}

      {SECTIONS.map(s => {
        const items = bySection.get(s.key) ?? []
        return (
          <div key={s.key ?? 'always'} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-800">{s.title} <span className="font-normal text-gray-400">({items.length})</span></div>
              <div className="text-xs text-gray-400">{s.blurb}</div>
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-4 text-center text-sm text-gray-400">Nothing here yet.</div>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {items.map(r => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-2.5 text-gray-800">{r.label}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}>
                          {r.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => toggleActive(r)} disabled={busy} className="text-xs text-gray-500 hover:underline">
                            {r.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                          <button onClick={() => remove(r)} disabled={busy} className="text-xs text-red-500 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
