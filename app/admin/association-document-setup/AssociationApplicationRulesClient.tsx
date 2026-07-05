'use client'

import { useEffect, useMemo, useState } from 'react'

interface Rule {
  id: string; association_code: string; rule_key: string; value: unknown
  label: string; enforcement: 'block' | 'warn'; active: boolean; created_at: string
}

// Known rule types get a friendlier input (toggle for booleans, number for counts/days/years).
// Staff can still add anything else via "Custom rule" -- rule_key is free text in the DB,
// so a brand-new restriction for a brand-new association never needs a code change.
const KNOWN_RULES: Array<{ key: string; label: string; kind: 'boolean' | 'number'; suffix?: string }> = [
  { key: 'individuals_only', label: 'Individuals only (no LLC/corporate purchasers)', kind: 'boolean' },
  { key: 'min_lease_days', label: 'Minimum lease term', kind: 'number', suffix: 'days' },
  { key: 'max_rentals_per_12mo', label: 'Max rentals per 12 months', kind: 'number', suffix: 'per year' },
  { key: 'no_rent_years_after_purchase', label: 'No renting for N years after purchase', kind: 'number', suffix: 'years' },
]

export default function AssociationApplicationRulesClient({ associations }: { associations: Array<{ association_code: string; association_name: string }> }) {
  const [assoc, setAssoc] = useState('')
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [ruleKey, setRuleKey] = useState(KNOWN_RULES[0].key)
  const [customKey, setCustomKey] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [value, setValue] = useState('')
  const [enforcement, setEnforcement] = useState<'block' | 'warn'>('warn')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = () => {
    fetch('/api/admin/association-application-rules?all=true').then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => setRules([]))
  }
  useEffect(load, [])

  const forAssoc = useMemo(() => (rules ?? []).filter(r => r.association_code === assoc), [rules, assoc])
  const isCustom = ruleKey === '__custom__'
  const known = KNOWN_RULES.find(r => r.key === ruleKey)

  async function add() {
    if (!assoc) { setMsg({ kind: 'err', text: 'Pick an association.' }); return }
    const key = isCustom ? customKey.trim() : ruleKey
    const label = isCustom ? customLabel.trim() : known!.label
    if (!key) { setMsg({ kind: 'err', text: 'Enter a rule key.' }); return }
    if (isCustom && !label) { setMsg({ kind: 'err', text: 'Enter a label.' }); return }
    let v: unknown = value
    if (known?.kind === 'boolean') v = true
    else if (known?.kind === 'number' || (isCustom && value && !isNaN(Number(value)))) v = Number(value)
    if (v === '' || v === undefined) { setMsg({ kind: 'err', text: 'Enter a value.' }); return }

    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/association-application-rules', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ associationCode: assoc, ruleKey: key, label, value: v, enforcement }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'failed')
      setCustomKey(''); setCustomLabel(''); setValue(''); load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function toggleActive(r: Rule) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/association-application-rules/${r.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: !r.active }),
      })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function remove(r: Rule) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/admin/association-application-rules/${r.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json())?.error ?? 'failed')
      load()
    } catch (e) { setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  const inputCls = 'rounded border border-gray-300 px-3 py-2 text-sm'

  return (
    <div className="space-y-4">
      <select value={assoc} onChange={e => setAssoc(e.target.value)} className={inputCls + ' w-full'}>
        <option value="">Select an association…</option>
        {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name} ({a.association_code})</option>)}
      </select>

      {assoc && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Add a rule for {assoc}</div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={ruleKey} onChange={e => setRuleKey(e.target.value)} className={inputCls}>
                {KNOWN_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                <option value="__custom__">Custom rule…</option>
              </select>
              {isCustom && (
                <>
                  <input value={customKey} onChange={e => setCustomKey(e.target.value)} placeholder="rule_key (e.g. min_credit_score)" className={inputCls + ' w-48'} />
                  <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="Label shown to staff/applicants" className={inputCls + ' flex-1 min-w-[200px]'} />
                </>
              )}
              {known?.kind !== 'boolean' && (
                <input value={value} onChange={e => setValue(e.target.value)} placeholder={known?.suffix ?? 'value'} className={inputCls + ' w-28'} />
              )}
              <select value={enforcement} onChange={e => setEnforcement(e.target.value as 'block' | 'warn')} className={inputCls}>
                <option value="block">Block in /apply</option>
                <option value="warn">Flag for staff review</option>
              </select>
              <button onClick={add} disabled={busy} className="rounded bg-[#f26a1b] px-4 py-2 text-sm font-semibold text-white hover:bg-[#d85a10] disabled:opacity-50">
                Add
              </button>
            </div>
            <p className="text-xs text-gray-400">
              &ldquo;Block&rdquo; rules are enforced automatically in the applicant form (e.g. hiding the Commercial option). &ldquo;Flag&rdquo; rules can&apos;t be checked from applicant-entered data alone (e.g. they depend on ownership-start-date or lease history) &mdash; they show up as a warning for staff/board to verify manually before approving.
            </p>
          </div>

          {msg && <div className={`rounded border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Rule</th>
                  <th className="px-4 py-2.5 font-medium">Value</th>
                  <th className="px-4 py-2.5 font-medium">Enforcement</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forAssoc.map(r => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2.5 text-gray-800">{r.label}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{JSON.stringify(r.value)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.enforcement === 'block' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                        {r.enforcement === 'block' ? 'Block' : 'Flag'}
                      </span>
                    </td>
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
                {forAssoc.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No application rules for this association yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
