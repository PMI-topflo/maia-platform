'use client'

import { useCallback, useEffect, useState } from 'react'

const SERVICE_TYPES = ['Landscaping', 'Pool', 'Janitorial', 'Pest Control', 'Other']
const CADENCES = ['weekly', 'biweekly', 'monthly']
const BILLING = ['monthly', 'weekly', 'per_visit']
const CHANNELS = ['email', 'sms', 'whatsapp']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Assoc { code: string; name: string }
interface Service { id: number; association_code: string; cinc_vendor_id: string | null; vendor_name: string; service_type: string; cadence: string; billing_cadence: string; expected_day: number | null; office_email: string | null; active: boolean }
interface Employee { id: string; cinc_vendor_id: string | null; vendor_name: string; name: string; phone: string | null; email: string | null; preferred_channel: string; active: boolean }

export default function Manager({ associations }: { associations: Assoc[] }) {
  const [assoc, setAssoc] = useState(associations[0]?.code ?? '')
  const [services, setServices] = useState<Service[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [error, setError] = useState<string | null>(null)

  // add-service form
  const [svc, setSvc] = useState({ vendor_name: '', cinc_vendor_id: '', service_type: 'Landscaping', cadence: 'weekly', billing_cadence: 'monthly', expected_day: '', office_email: '' })
  // add-employee form
  const [emp, setEmp] = useState({ vendor_name: '', cinc_vendor_id: '', name: '', phone: '', email: '', preferred_channel: 'email' })

  const load = useCallback(async () => {
    setError(null)
    try {
      const [s, e] = await Promise.all([
        fetch(`/api/admin/recurring-services?assoc=${encodeURIComponent(assoc)}`).then(r => r.json()),
        fetch(`/api/admin/vendor-employees`).then(r => r.json()),
      ])
      setServices(s.services ?? [])
      setEmployees(e.employees ?? [])
    } catch { setError('Failed to load.') }
  }, [assoc])
  useEffect(() => { if (assoc) void load() }, [assoc, load])

  async function addService() {
    if (!svc.vendor_name.trim()) { setError('Vendor name required.'); return }
    const res = await fetch('/api/admin/recurring-services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...svc, association_code: assoc, expected_day: svc.expected_day === '' ? null : Number(svc.expected_day) }),
    })
    if (!res.ok) { setError((await res.json())?.error ?? 'Add failed'); return }
    setSvc({ vendor_name: '', cinc_vendor_id: '', service_type: 'Landscaping', cadence: 'weekly', billing_cadence: 'monthly', expected_day: '', office_email: '' })
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
    setEmp({ vendor_name: '', cinc_vendor_id: '', name: '', phone: '', email: '', preferred_channel: 'email' })
    void load()
  }
  async function delEmployee(id: string) {
    if (!confirm('Remove this employee?')) return
    await fetch(`/api/admin/vendor-employees/${id}`, { method: 'DELETE' }); void load()
  }

  return (
    <div style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
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
              <div style={muted}>services {s.cadence}{s.expected_day != null ? ` (${DAYS[s.expected_day]})` : ''} · bills {s.billing_cadence}{s.office_email ? ` · ${s.office_email}` : ''}</div>
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
          <select value={svc.expected_day} onChange={e => setSvc({ ...svc, expected_day: e.target.value })} style={field}>
            <option value="">— day (optional) —</option>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <input placeholder="Vendor office email" value={svc.office_email} onChange={e => setSvc({ ...svc, office_email: e.target.value })} style={field} />
        </div>
        <button onClick={addService} style={addBtn}>+ Add service</button>
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
              <div style={muted}>{[e.preferred_channel, e.phone, e.email].filter(Boolean).join(' · ')}</div>
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
          <select value={emp.preferred_channel} onChange={e => setEmp({ ...emp, preferred_channel: e.target.value })} style={field}>
            {CHANNELS.map(c => <option key={c}>{c}</option>)}
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
