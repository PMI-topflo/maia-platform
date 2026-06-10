'use client'

import { useCallback, useEffect, useState } from 'react'

const SERVICE_TYPES = ['Landscaping', 'Pool', 'Janitorial', 'Pest Control', 'Other']
const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly']
const BILLING = ['monthly', 'weekly', 'per_visit']
const CHANNELS = ['email', 'sms', 'whatsapp']
const LANGS = [['en', 'English'], ['es', 'Español'], ['pt', 'Português'], ['ht', 'Kreyòl'], ['fr', 'Français']]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Assoc { code: string; name: string }
interface Service { id: number; association_code: string; cinc_vendor_id: string | null; vendor_name: string; service_type: string; cadence: string; billing_cadence: string; expected_day: number | null; schedule_anchor: string | null; monthly_day: number | null; office_email: string | null; active: boolean }
interface Employee { id: string; cinc_vendor_id: string | null; vendor_name: string; name: string; phone: string | null; email: string | null; preferred_channel: string; preferred_language: string; active: boolean }
interface Visit { id: number; service_type: string | null; vendor_name: string | null; week_of: string; status: string; ticket_id: number | null }

export default function Manager({ associations }: { associations: Assoc[] }) {
  const [assoc, setAssoc] = useState(associations[0]?.code ?? '')
  const [services, setServices] = useState<Service[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // add-service form
  const [svc, setSvc] = useState({ vendor_name: '', cinc_vendor_id: '', service_type: 'Landscaping', cadence: 'weekly', billing_cadence: 'monthly', expected_day: '', schedule_anchor: '', monthly_day: '', office_email: '', office_language: 'en' })
  // add-employee form
  const [emp, setEmp] = useState({ vendor_name: '', cinc_vendor_id: '', name: '', phone: '', email: '', preferred_channel: 'email', preferred_language: 'en' })

  const load = useCallback(async () => {
    setError(null)
    try {
      const [s, e, v] = await Promise.all([
        fetch(`/api/admin/recurring-services?assoc=${encodeURIComponent(assoc)}`).then(r => r.json()),
        fetch(`/api/admin/vendor-employees`).then(r => r.json()),
        fetch(`/api/admin/service-visits?assoc=${encodeURIComponent(assoc)}`).then(r => r.json()),
      ])
      setServices(s.services ?? [])
      setEmployees(e.employees ?? [])
      setVisits(v.visits ?? [])
    } catch { setError('Failed to load.') }
  }, [assoc])
  useEffect(() => { if (assoc) void load() }, [assoc, load])

  async function addService() {
    if (!svc.vendor_name.trim()) { setError('Vendor name required.'); return }
    const res = await fetch('/api/admin/recurring-services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...svc,
        association_code: assoc,
        expected_day:    svc.expected_day === '' ? null : Number(svc.expected_day),
        schedule_anchor: svc.cadence === 'biweekly' && svc.schedule_anchor ? svc.schedule_anchor : null,
        monthly_day:     svc.cadence === 'monthly' && svc.monthly_day !== '' ? Number(svc.monthly_day) : null,
      }),
    })
    if (!res.ok) { setError((await res.json())?.error ?? 'Add failed'); return }
    setSvc({ vendor_name: '', cinc_vendor_id: '', service_type: 'Landscaping', cadence: 'weekly', billing_cadence: 'monthly', expected_day: '', schedule_anchor: '', monthly_day: '', office_email: '', office_language: 'en' })
    void load()
  }
  async function delService(id: number) {
    if (!confirm('Remove this recurring service?')) return
    await fetch(`/api/admin/recurring-services/${id}`, { method: 'DELETE' }); void load()
  }
  async function addEmployee() {
    if (!emp.vendor_name.trim() || !emp.name.trim()) { setError('Vendor + employee name required.'); return }
    const res = await fetch('/api/admin/vendor-employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(emp),
    })
    if (!res.ok) { setError((await res.json())?.error ?? 'Add failed'); return }
    setEmp({ vendor_name: '', cinc_vendor_id: '', name: '', phone: '', email: '', preferred_channel: 'email', preferred_language: 'en' })
    void load()
  }
  async function delEmployee(id: string) {
    if (!confirm('Remove this employee?')) return
    await fetch(`/api/admin/vendor-employees/${id}`, { method: 'DELETE' }); void load()
  }
  async function generateVisits() {
    setBusy('gen'); setError(null)
    try {
      const res = await fetch('/api/admin/recurring-services/generate-visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'Failed')
      void load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  async function sendLinks(visitId: number) {
    setBusy(`v${visitId}`); setError(null)
    try {
      const res = await fetch(`/api/admin/service-visits/${visitId}/send-links`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error ?? 'Failed')
      alert(`Sent ${j.sent} link(s):\n${(j.results ?? []).join('\n')}`)
    } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div style={{ maxWidth: 1500, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Recurring services</h1>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 16px' }}>
        Set the fixed weekly vendors for each association and their crew. Weekly visits + upload links come next.
      </p>

      <label style={lbl}>Association</label>
      <select value={assoc} onChange={e => setAssoc(e.target.value)} style={{ ...field, maxWidth: 420 }}>
        {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
      </select>

      {error && <div style={{ color: '#991b1b', fontSize: 13, margin: '10px 0' }}>⚠ {error}</div>}

      {/* Recurring services for the chosen association */}
      <section style={card}>
        <h2 style={h2}>Services for {assoc}</h2>
        {services.length === 0 && <p style={muted}>No recurring services yet.</p>}
        {services.map(s => (
          <div key={s.id} style={row}>
            <div>
              <strong>{s.service_type}</strong> — {s.vendor_name}
              {s.cinc_vendor_id ? <span style={muted}> · CINC #{s.cinc_vendor_id}</span> : null}
              <div style={muted}>services {s.cadence}{s.expected_day != null ? ` (${DAYS[s.expected_day]})` : ''}{s.cadence === 'biweekly' && s.schedule_anchor ? ` from ${s.schedule_anchor}` : ''}{s.cadence === 'monthly' ? ` on day ${s.monthly_day ?? 1}` : ''} · bills {s.billing_cadence}{s.office_email ? ` · ${s.office_email}` : ''}</div>
            </div>
            <button onClick={() => delService(s.id)} style={delBtn}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          <select value={svc.service_type} onChange={e => setSvc({ ...svc, service_type: e.target.value })} style={field}>
            {SERVICE_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <input placeholder="Vendor name" value={svc.vendor_name} onChange={e => setSvc({ ...svc, vendor_name: e.target.value })} style={field} />
          <input placeholder="CINC vendor # (optional)" value={svc.cinc_vendor_id} onChange={e => setSvc({ ...svc, cinc_vendor_id: e.target.value })} style={field} />
          <select value={svc.cadence} onChange={e => setSvc({ ...svc, cadence: e.target.value })} style={field} title="How often they service">
            {CADENCES.map(c => <option key={c} value={c}>services {c}</option>)}
          </select>
          <select value={svc.billing_cadence} onChange={e => setSvc({ ...svc, billing_cadence: e.target.value })} style={field} title="How the vendor bills">
            {BILLING.map(c => <option key={c} value={c}>bills {c}</option>)}
          </select>
          <select value={svc.expected_day} onChange={e => setSvc({ ...svc, expected_day: e.target.value })} style={field} title="Expected day of the week (used for late/missed timing)">
            <option value="">— day (optional) —</option>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          {svc.cadence === 'biweekly' && (
            <input type="date" value={svc.schedule_anchor} onChange={e => setSvc({ ...svc, schedule_anchor: e.target.value })} style={field} title="Biweekly anchor: pick any date in an ON week — alternating weeks from here are due" />
          )}
          {svc.cadence === 'monthly' && (
            <input type="number" min={1} max={31} placeholder="Day of month (1–31)" value={svc.monthly_day} onChange={e => setSvc({ ...svc, monthly_day: e.target.value })} style={field} title="Monthly: day-of-month the visit is due (the week containing it counts)" />
          )}
          <input placeholder="Vendor office email" value={svc.office_email} onChange={e => setSvc({ ...svc, office_email: e.target.value })} style={field} />
          <select value={svc.office_language} onChange={e => setSvc({ ...svc, office_language: e.target.value })} style={field} title="Language for the weekly agenda email to the office">
            {LANGS.map(([v, label]) => <option key={v} value={v}>office: {label}</option>)}
          </select>
        </div>
        <button onClick={addService} style={addBtn}>+ Add service</button>
      </section>

      {/* This week's / recent visits */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={h2}>Service visits</h2>
          <button onClick={generateVisits} disabled={busy === 'gen'} style={addBtn}>
            {busy === 'gen' ? 'Generating…' : "Generate this week's visits"}
          </button>
        </div>
        <p style={muted}>Each visit is a documentation work order — the crew uploads photos + a brief report via their link.</p>
        {visits.length === 0 && <p style={muted}>No visits yet. Click “Generate this week’s visits”.</p>}
        {visits.map(v => (
          <div key={v.id} style={row}>
            <div>
              <strong>{v.service_type}</strong> <span style={muted}>· {v.vendor_name} · week of {v.week_of}</span>
              <div style={muted}>
                status: {v.status}
                {v.ticket_id ? <> · <a href={`/admin/tickets/${v.ticket_id}`} style={{ color: '#2563eb' }}>work order →</a></> : null}
              </div>
            </div>
            <button onClick={() => sendLinks(v.id)} disabled={busy === `v${v.id}`} style={addBtn}>
              {busy === `v${v.id}` ? 'Sending…' : '📤 Send crew links'}
            </button>
          </div>
        ))}
      </section>

      {/* Vendor employees (crew) */}
      <section style={card}>
        <h2 style={h2}>Vendor crew</h2>
        <p style={muted}>People who get the weekly upload link. Grouped by vendor.</p>
        {employees.length === 0 && <p style={muted}>No employees yet.</p>}
        {employees.map(e => (
          <div key={e.id} style={row}>
            <div>
              <strong>{e.name}</strong> <span style={muted}>· {e.vendor_name}</span>
              <div style={muted}>{[e.preferred_channel, (LANGS.find(l => l[0] === e.preferred_language)?.[1] ?? e.preferred_language), e.phone, e.email].filter(Boolean).join(' · ')}</div>
            </div>
            <button onClick={() => delEmployee(e.id)} style={delBtn}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          <input placeholder="Vendor name" value={emp.vendor_name} onChange={e => setEmp({ ...emp, vendor_name: e.target.value })} style={field} />
          <input placeholder="CINC vendor # (optional)" value={emp.cinc_vendor_id} onChange={e => setEmp({ ...emp, cinc_vendor_id: e.target.value })} style={field} />
          <input placeholder="Employee name" value={emp.name} onChange={e => setEmp({ ...emp, name: e.target.value })} style={field} />
          <input placeholder="Phone" value={emp.phone} onChange={e => setEmp({ ...emp, phone: e.target.value })} style={field} />
          <input placeholder="Email" value={emp.email} onChange={e => setEmp({ ...emp, email: e.target.value })} style={field} />
          <select value={emp.preferred_channel} onChange={e => setEmp({ ...emp, preferred_channel: e.target.value })} style={field} title="How they get the link">
            {CHANNELS.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={emp.preferred_language} onChange={e => setEmp({ ...emp, preferred_language: e.target.value })} style={field} title="Language for their link + page">
            {LANGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <button onClick={addEmployee} style={addBtn}>+ Add employee</button>
      </section>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', margin: '0 0 4px' }
const field: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 16 }
const h2: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 8px' }
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f3f4f6', fontSize: 13 }
const muted: React.CSSProperties = { color: '#9ca3af', fontSize: 12 }
const addBtn: React.CSSProperties = { marginTop: 10, padding: '8px 16px', borderRadius: 6, border: 'none', background: '#f26a1b', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const delBtn: React.CSSProperties = { fontSize: 11, color: '#991b1b', background: 'none', border: '1px solid #fecaca', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }
