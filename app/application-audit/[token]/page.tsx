'use client'

// Public, read-only Processing audit behind a share link staff create on
// the application page and email to a realtor / applicant / board member
// asking why an application is taking long. No login — the link is the
// credential (same as /request/[token]). Never shows emails or file names.

import { use, useEffect, useState } from 'react'
import ProcessingAuditCard from '@/components/ProcessingAuditCard'
import type { ProcessingAudit } from '@/lib/application-audit'

export default function ApplicationAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [a, setA] = useState<Omit<ProcessingAudit, 'files'> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/application-audit/${token}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(j => setA(j.audit)).catch(e => setErr(String(e.message ?? e)))
  }, [token])
  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eceef2', fontFamily: 'system-ui', padding: '28px 16px' }
  const card: React.CSSProperties = { maxWidth: 720, margin: '0 auto', background: '#fff', border: '1px solid #e7e2d9', borderRadius: 14, padding: '26px 28px' }
  if (err) return <div style={wrap}><div style={card}><h1 style={{ font: '800 20px Georgia,serif', color: '#1c2333' }}>Link unavailable</h1><p style={{ color: '#6b7280' }}>{err}</p><p style={{ color: '#9ca3af', fontSize: 13 }}>Questions: PMI@topfloridaproperties.com · (305) 900-5077</p></div></div>
  if (!a) return <div style={wrap}><div style={card}><p style={{ color: '#9ca3af' }}>Loading…</p></div></div>
  const type = a.applicationType === 'purchase' ? 'Purchase' : a.applicationType === 'lease_renewal' ? 'Lease renewal' : 'Lease'
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ font: '700 11px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0571a', marginBottom: 10 }}>PMI Top Florida Properties</div>
        <h1 style={{ font: '800 24px/1.2 Georgia,serif', color: '#1c2333', margin: '0 0 6px' }}>Application timeline{a.unitLabel ? ` — Unit ${a.unitLabel}` : ''}</h1>
        <div style={{ font: '13.5px system-ui', color: '#6b7280', marginBottom: 18 }}>{a.associationName} · {type}{a.applicants.length ? ` · ${a.applicants.join(', ')}` : ''}</div>
        <ProcessingAuditCard a={a} />
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 18, borderTop: '1px solid #e7e2d9', paddingTop: 12 }}>
          Every line above comes from the application record as of {new Date(a.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET. Questions: PMI@topfloridaproperties.com · (305) 900-5077.
        </p>
      </div>
    </div>
  )
}
