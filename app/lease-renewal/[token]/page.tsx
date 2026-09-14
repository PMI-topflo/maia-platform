'use client'

// Public token-gated page (no login — the link is the auth, matching
// /request/[token]'s precedent): the owner or tenant reports what's
// actually happening with a lease that's about to end. Linked from both the
// 30-day and 7-day "Lease expiring" reminder emails
// (app/api/cron/lease-renewal-alerts/route.ts). See lib/lease-renewal-check.ts
// for what each answer triggers.

import { use, useCallback, useEffect, useState } from 'react'

interface Data {
  role: 'owner' | 'tenant'; unitLabel: string; associationCode: string; leaseEnd: string; name: string | null
  ownerOccupancy: string | null; ownerResponse: string | null; ownerRespondedAt: string | null
  tenantResponse: string | null; tenantRespondedAt: string | null
}

const TENANT_OPTIONS: { key: string; title: string; blurb: string }[] = [
  { key: 'renew', title: 'I will renew the lease', blurb: 'Let us know you plan to stay — we’ll follow up with next steps.' },
  { key: 'vacating', title: 'I will vacate the unit at the end of this term', blurb: 'We’ll update the unit’s status and notify the owner.' },
  { key: 'vacated', title: 'I already vacated', blurb: 'We’ll update the unit’s status right away.' },
  { key: 'signed', title: 'I have already signed a new lease', blurb: 'We’ll send you a secure link to upload the signed lease.' },
  { key: 'apply', title: 'I need to start a renewal application', blurb: 'We’ll open the renewal application and email you the full list of documents needed.' },
]
const OWNER_ACTIONS: { key: string; title: string; blurb: string }[] = [
  { key: 'signed', title: 'The tenant has already signed a new lease', blurb: 'We’ll send a secure link to upload the signed lease.' },
  { key: 'renew', title: 'I will renew the lease', blurb: 'We’ll open the renewal application and email the full document checklist.' },
]
const OCCUPANCY: { key: string; title: string }[] = [
  { key: 'leased', title: 'Leased' },
  { key: 'owner_occupied', title: 'Owner-occupied' },
  { key: 'vacant', title: 'Vacant' },
]

export default function LeaseRenewalCheck({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  // The reminder email has one button per answer (lib/lease-renewal-email.ts);
  // the clicked one arrives here as ?occupancy=…&response=…. It is shown
  // preselected with a single Confirm click — never auto-submitted, because
  // mail-security link scanners follow every URL in an email.
  const [pre, setPre] = useState<{ occupancy: string | null; response: string | null } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const occupancy = q.get('occupancy'), response = q.get('response')
    if (occupancy || response) setPre({ occupancy, response })
  }, [])

  const load = useCallback(() => {
    fetch(`/api/lease-renewal/${token}`).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setD).catch(e => setErr(String(e.message ?? e)))
  }, [token])
  useEffect(load, [load])

  async function post(body: Record<string, unknown>, tag: string) {
    setBusy(tag); setActionErr(null)
    try {
      const r = await fetch(`/api/lease-renewal/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'failed')
      load()
    } catch (e) { setActionErr((e as Error).message) } finally { setBusy(null) }
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eceef2', fontFamily: 'system-ui', padding: '28px 16px' }
  const card: React.CSSProperties = { maxWidth: 600, margin: '0 auto', background: '#fff', border: '1px solid #e7e2d9', borderRadius: 14, padding: '30px 32px' }

  if (err) return <div style={wrap}><div style={card}><h1 style={{ font: '800 20px Georgia,serif', color: '#1c2333' }}>Link unavailable</h1><p style={{ color: '#6b7280' }}>{err}</p><p style={{ color: '#9ca3af', fontSize: 13 }}>Please contact support@topfloridaproperties.com.</p></div></div>
  if (!d) return <div style={wrap}><div style={card}><p style={{ color: '#9ca3af' }}>Loading…</p></div></div>

  const fmt = (iso: string) => new Date(iso.includes('T') ? iso : `${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const ended = d.leaseEnd.slice(0, 10) < new Date().toISOString().slice(0, 10)

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ font: '700 11px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#c0571a', marginBottom: 10 }}>PMI Top Florida Properties</div>
        <h1 style={{ font: '800 24px/1.2 Georgia,serif', color: '#1c2333', margin: '0 0 12px' }}>Lease renewal check-in</h1>
        <div style={{ border: '1px solid #e7e2d9', borderRadius: 10, overflow: 'hidden', marginBottom: 18, fontSize: 13.5 }}>
          <div style={{ display: 'flex', gap: 12, padding: '9px 14px', background: '#faf8f4' }}><span style={{ width: 90, color: '#8a8f9a', font: '700 11px system-ui', textTransform: 'uppercase', letterSpacing: '.05em' }}>Unit</span><b style={{ color: '#1c2333' }}>{d.unitLabel}</b></div>
          <div style={{ display: 'flex', gap: 12, padding: '9px 14px', borderTop: '1px solid #f2efe8' }}><span style={{ width: 90, color: '#8a8f9a', font: '700 11px system-ui', textTransform: 'uppercase', letterSpacing: '.05em' }}>{ended ? 'Lease ended' : 'Lease ends'}</span><b style={{ color: '#1c2333' }}>{fmt(d.leaseEnd)}</b></div>
        </div>
        <p style={{ fontSize: 14.5, color: '#3f4756', margin: '0 0 18px' }}>
          {d.name ? `Hi ${d.name}, ` : ''}{introText(d.role, ended)}
        </p>

        {actionErr && <div style={{ font: '13px system-ui', color: '#b91c1c', marginBottom: 12 }}>{actionErr}</div>}

        {(() => {
          const answered = d.role === 'owner' ? !!(d.ownerResponse || (d.ownerOccupancy && d.ownerOccupancy !== 'leased')) : !!d.tenantResponse
          const preset = pre && !answered ? presetLabel(d.role, pre) : null
          if (preset) {
            return (
              <div style={{ border: '1.5px solid #c0571a', background: '#fff7f0', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
                <div style={{ font: '700 12px system-ui', color: '#c0571a', textTransform: 'uppercase', letterSpacing: '.08em' }}>Your answer from the email</div>
                <div style={{ font: '800 18px Georgia,serif', color: '#1c2333', margin: '6px 0 12px' }}>{preset.title}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button disabled={!!busy} onClick={() => post(preset.body, 'preset')} style={{ background: '#c0571a', color: '#fff', border: 0, borderRadius: 9, padding: '11px 22px', font: '700 14px system-ui', cursor: busy ? 'default' : 'pointer' }}>
                    {busy === 'preset' ? 'Saving…' : '✓ Confirm'}
                  </button>
                  <button disabled={!!busy} onClick={() => setPre(null)} style={{ background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 9, padding: '11px 16px', font: '600 13px system-ui', cursor: 'pointer' }}>
                    Pick a different answer
                  </button>
                </div>
              </div>
            )
          }
          return d.role === 'owner'
            ? <OwnerPanel d={d} busy={busy} post={post} />
            : <TenantPanel d={d} busy={busy} post={post} />
        })()}

        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 22, borderTop: '1px solid #e7e2d9', paddingTop: 14 }}>
          Questions? Reply to the reminder email or contact <strong>PMI@topfloridaproperties.com</strong> · (305) 900-5077.
        </p>
      </div>
    </div>
  )
}

function introText(role: 'owner' | 'tenant', ended: boolean): string {
  if (role === 'owner') {
    return ended
      ? 'the lease we have on file for this unit has ended. Tell us what is happening now so the association records are right — pick one option below.'
      : 'the lease we have on file for this unit is about to end. Tell us what is happening next so the association records are right — pick one option below.'
  }
  return ended
    ? 'the lease we have on file for you has ended. Tell us what is happening now — pick one option below.'
    : 'your lease is about to end. Tell us what is happening next — pick one option below.'
}

/** What MAIA does after each answer — shown in the confirmation so the
 *  person knows the click did something and what (if anything) comes next. */
function nextStep(role: 'owner' | 'tenant', key: string, unit: string): string {
  const k = `${role}:${key}`
  switch (k) {
    case 'owner:vacant': return `Unit ${unit} is now recorded as vacant and the office has been told. When a new tenant is found, they must apply and be approved by the association before moving in.`
    case 'owner:owner_occupied': return `Unit ${unit} is now recorded as owner-occupied and the office has been told. No further action is needed.`
    case 'owner:renew': return 'We opened the renewal application and emailed the list of documents needed. Nothing else is needed from you right now.'
    case 'owner:signed': return 'Check your email for a secure link to upload the signed lease. That is the only thing still needed.'
    case 'tenant:renew': return 'The office has been told you are staying; we will email you the next steps for the renewal.'
    case 'tenant:vacating': return `Unit ${unit} will be recorded as vacant when your lease ends and the owner has been told. No further action is needed.`
    case 'tenant:vacated': return `Unit ${unit} is now recorded as vacant and the owner has been told. No further action is needed.`
    case 'tenant:signed': return 'Check your email for a secure link to upload the signed lease. That is the only thing still needed.'
    case 'tenant:apply': return 'We opened the renewal application and emailed you the full list of documents needed.'
    default: return 'The office has been told. No further action is needed.'
  }
}

function DoneBox({ unit, title, next }: { unit: string; title: string; next: string }) {
  return (
    <div style={{ background: '#e8f3ec', border: '1px solid #15803d', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ font: '700 12px system-ui', color: '#15803d', textTransform: 'uppercase', letterSpacing: '.08em' }}>✓ Answer received — Unit {unit}</div>
      <div style={{ font: '800 18px Georgia,serif', color: '#14532d', margin: '6px 0 8px' }}>{title}</div>
      <div style={{ font: '14px system-ui', color: '#166534', lineHeight: 1.5 }}>{next}</div>
      <div style={{ font: '12.5px system-ui', color: '#4b5563', marginTop: 10 }}>You can close this page. Something changed? Reply to our email or call (305) 900-5077.</div>
    </div>
  )
}

/** Title + POST body for a choice carried in the email link, or null when
 *  the query doesn't name a valid option for this party (then the normal
 *  panel shows). Mirrors the keys the API accepts. */
function presetLabel(role: 'owner' | 'tenant', pre: { occupancy: string | null; response: string | null }): { title: string; body: Record<string, unknown> } | null {
  if (role === 'tenant') {
    const o = TENANT_OPTIONS.find(x => x.key === pre.response)
    return o ? { title: o.title, body: { response: o.key } } : null
  }
  if (pre.occupancy === 'leased') {
    const a = OWNER_ACTIONS.find(x => x.key === pre.response)
    return a ? { title: a.title, body: { occupancy: 'leased', response: a.key } } : null
  }
  const occ = OCCUPANCY.find(x => x.key === pre.occupancy)
  if (!occ) return null
  const title = occ.key === 'vacant' ? 'The unit is vacant' : occ.key === 'owner_occupied' ? 'I live in the unit myself' : occ.title
  return { title, body: { occupancy: occ.key } }
}

function OptionButton({ title, blurb, active, disabled, onClick }: { title: string; blurb: string; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      textAlign: 'left', width: '100%', border: `1.5px solid ${active ? '#c0571a' : '#e2e5ec'}`, background: active ? '#fff7f0' : '#fff',
      borderRadius: 10, padding: '13px 15px', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
    }}>
      <div style={{ font: '700 14.5px system-ui', color: '#1c2333' }}>{title}</div>
      <div style={{ font: '12.5px system-ui', color: '#6b7280', marginTop: 3, lineHeight: 1.45 }}>{blurb}</div>
    </button>
  )
}

function TenantPanel({ d, busy, post }: { d: Data; busy: string | null; post: (b: Record<string, unknown>, tag: string) => void }) {
  if (d.tenantResponse) return <DoneBox unit={d.unitLabel} title={TENANT_OPTIONS.find(o => o.key === d.tenantResponse)?.title ?? d.tenantResponse} next={nextStep('tenant', d.tenantResponse, d.unitLabel)} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {TENANT_OPTIONS.map(o => (
        <OptionButton key={o.key} title={o.title} blurb={o.blurb} active={false} disabled={!!busy}
          onClick={() => post({ response: o.key }, o.key)} />
      ))}
    </div>
  )
}

function OwnerPanel({ d, busy, post }: { d: Data; busy: string | null; post: (b: Record<string, unknown>, tag: string) => void }) {
  const [occupancy, setOccupancy] = useState(d.ownerOccupancy)
  const done = d.ownerResponse || (occupancy && occupancy !== 'leased')
  if (done && d.ownerOccupancy) {
    const answerKey = d.ownerResponse ?? d.ownerOccupancy ?? ''
    const label = d.ownerResponse ? OWNER_ACTIONS.find(o => o.key === d.ownerResponse)?.title ?? d.ownerResponse
      : d.ownerOccupancy === 'vacant' ? 'The unit is vacant' : d.ownerOccupancy === 'owner_occupied' ? 'I live in the unit myself' : OCCUPANCY.find(o => o.key === d.ownerOccupancy)?.title ?? ''
    return <DoneBox unit={d.unitLabel} title={label ?? ''} next={nextStep('owner', answerKey, d.unitLabel)} />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ font: '700 13px system-ui', color: '#1c2333', marginBottom: 8 }}>Is the unit vacant, owner-occupied, or leased?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {OCCUPANCY.map(o => (
            <button key={o.key} disabled={!!busy} onClick={() => { setOccupancy(o.key); if (o.key !== 'leased') post({ occupancy: o.key }, o.key) }}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 9, font: '700 13px system-ui', cursor: busy ? 'default' : 'pointer',
                border: `1.5px solid ${occupancy === o.key ? '#c0571a' : '#d1d5db'}`, background: occupancy === o.key ? '#fff7f0' : '#fff',
                color: occupancy === o.key ? '#c0571a' : '#374151',
              }}>{o.title}</button>
          ))}
        </div>
      </div>
      {occupancy === 'leased' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {OWNER_ACTIONS.map(o => (
            <OptionButton key={o.key} title={o.title} blurb={o.blurb} active={false} disabled={!!busy}
              onClick={() => post({ occupancy: 'leased', response: o.key }, o.key)} />
          ))}
        </div>
      )}
    </div>
  )
}
