'use client'

// Public Pre-Application Compliance intake (B4) — one link per association, a
// MULTI-COLLABORATION flow. The person who opens the link: (1) picks what they
// are applying for, (2) self-identifies their role (tenant/buyer, owner,
// listing agent, tenant agent), (3) enters their contact + unit, (4) adds
// everyone else involved so MAIA emails each their own link to fill their part
// in parallel, then (5) uploads their documents and — only if they are a tenant/
// buyer or owner — signs the association-rules acknowledgment. Agents upload but
// never sign. Invited collaborators arrive via ?t=<token> straight on step 5.

import { use, useCallback, useEffect, useState } from 'react'
import { SignaturePad } from '@/components/SignatureEvidence'
import { preApplyStrings, preApplyFlow } from '@/lib/preapply-welcome-i18n'
import { PORTAL_LANGS, PORTAL_LANG_LABEL, isRtl, normalizePortalLang, type PortalLang } from '@/lib/portal-i18n'

const TYPE_DEFS = [
  { key: 'lease',               icon: '🏠', tk: 't1t', dk: 't1d' },
  { key: 'purchase',            icon: '🔑', tk: 't2t', dk: 't2d' },
  { key: 'lease_renewal',       icon: '🔄', tk: 't3t', dk: 't3d' },
  { key: 'additional_occupant', icon: '👥', tk: 't4t', dk: 't4d' },
] as const

const ROLE_DEFS = [
  { key: 'applicant',       icon: '🧑', lk: 'roleApplicant',    dk: 'roleApplicantD' },
  { key: 'owner',           icon: '🔑', lk: 'roleOwner',        dk: 'roleOwnerD' },
  { key: 'listing_agent',   icon: '🏷️', lk: 'roleListingAgent', dk: 'roleListingAgentD' },
  { key: 'applicant_agent', icon: '🤝', lk: 'roleTenantAgent',  dk: 'roleTenantAgentD' },
] as const

const WELCOME_CSS = `
.pa-page{max-width:720px;margin:0 auto;padding:0 18px 48px;font-family:'Inter',system-ui,-apple-system,sans-serif;color:#1f2a44}
.pa-page[dir=rtl]{text-align:right}
.pa-hero{background:linear-gradient(160deg,#1f2a44 0%,#2b3a5e 60%,#3a2a1a 100%);color:#fff;border-radius:0 0 26px 26px;padding:22px 30px 40px;position:relative;overflow:hidden}
.pa-hero::after{content:'';position:absolute;right:-60px;top:-60px;width:220px;height:220px;background:radial-gradient(circle,#f26a1b55,transparent 70%)}
.pa-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.pa-brand{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f7b98a;font-weight:700}
.pa-dot{width:7px;height:7px;border-radius:50%;background:#f26a1b}
.pa-lang{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:6px 10px;font-size:12.5px;font-weight:600;cursor:pointer}
.pa-lang option{color:#1f2a44}
.pa-assoc{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-top:20px;font-weight:600}
.pa-h1{font-size:29px;line-height:1.15;margin:6px 0 0;font-weight:800;letter-spacing:-.02em}
.pa-lede{font-size:15px;line-height:1.6;color:rgba(255,255,255,.82);margin:16px 0 0}
.pa-pill{display:inline-flex;gap:7px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:8px 14px;font-size:12.5px;font-weight:600;color:#fff;margin-top:20px;line-height:1.45}
.pa-card{background:#fff;border:1px solid #e7e9ee;border-radius:16px;padding:22px;margin-top:16px;box-shadow:0 1px 3px rgba(20,30,60,.05)}
.pa-eye{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#f26a1b}
.pa-card h2{font-size:18px;margin:5px 0 4px;font-weight:700}
.pa-card p{font-size:13.5px;line-height:1.55;color:#5c6473;margin:0}
.pa-langline{margin-top:14px;font-size:14px;font-weight:600;color:#33405c}
.pa-langline i{color:#c7cad2;margin:0 3px;font-weight:400;font-style:normal}
.pa-sec{display:flex;gap:16px;align-items:flex-start}
.pa-shield{flex:none;width:46px;height:46px;border-radius:12px;background:linear-gradient(150deg,#0f7a4d,#12a463);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px}
.pa-chan{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.pa-chip{display:inline-flex;gap:6px;background:#f0fdf6;border:1px solid #b9ecce;color:#0f7a4d;border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:600}
.pa-first{margin-top:12px;font-size:12.5px;color:#0f7a4d;background:#f0fdf6;border-radius:9px;padding:9px 11px;border:1px solid #cdeedd;line-height:1.45}
.pa-types{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
@media(max-width:520px){.pa-types{grid-template-columns:1fr}.pa-h1{font-size:24px}}
.pa-type{text-align:inherit;border:1.5px solid #e2e5ec;background:#fff;border-radius:14px;padding:16px 15px;cursor:pointer;transition:.15s;font-family:inherit}
.pa-type:hover{border-color:#f26a1b}
.pa-type.on{border-color:#f26a1b;background:#fff7f0}
.pa-ic{font-size:24px}.pa-tt{font-weight:700;font-size:15px;margin-top:8px}.pa-td{font-size:12.5px;color:#6b7280;margin-top:2px;line-height:1.45}
.pa-cta{width:100%;margin-top:18px;padding:15px;border:none;border-radius:12px;background:#f26a1b;color:#fff;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 6px 16px rgba(242,106,27,.28);font-family:inherit}
.pa-cta:disabled{background:#c9ccd3;box-shadow:none;cursor:default}
.pa-foot{text-align:center;color:#9aa0ab;font-size:11.5px;margin-top:22px;line-height:1.7}
.pa-field{width:100%;padding:11px 12px;font-size:15px;border:1px solid #d1d5db;border-radius:9px;box-sizing:border-box;margin-top:5px;font-family:inherit}
.pa-lbl{font-size:12.5px;font-weight:600;color:#374151;margin-top:14px;display:block}
.pa-collab-row{display:grid;grid-template-columns:1fr 1fr 150px 32px;gap:8px;margin-top:10px}
@media(max-width:560px){.pa-collab-row{grid-template-columns:1fr 1fr;}.pa-collab-row .pa-rm{grid-column:2;justify-self:end}}
.pa-x{background:#f3f4f6;border:none;border-radius:8px;font-size:16px;color:#6b7280;cursor:pointer}
.pa-link{background:none;border:none;color:#6b7280;font-size:13px;cursor:pointer;font-family:inherit}
.pa-ghost{width:100%;margin-top:12px;padding:11px;border:1.5px dashed #d1d5db;border-radius:10px;background:#fff;color:#374151;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit}
`

interface ChecklistItem { id: string; doc_key: string; label: string; provided_by: 'applicant' | 'landlord' | 'agent'; required: boolean; note: string | null; uploaded: boolean; mine: boolean }
interface Collaborator { id: string; name: string | null; email: string | null; role: string; roleLabel: string; isPrimary: boolean; status: string; signs: boolean; signed: boolean; emailVerified: boolean }
interface Info {
  associationName: string; type: string; unitLabel: string | null
  me: { name: string | null; role: string; roleLabel: string; signs: boolean; isPrimary: boolean; status: string; emailVerified: boolean; emailMasked: string | null; signed: boolean }
  canAddCollaborators: boolean; submitted: boolean
  checklist: ChecklistItem[]; rules: { rule_key: string; label: string }[]; collaborators: Collaborator[]
}

const wrap: React.CSSProperties = { maxWidth: 640, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' }
const field: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 15, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box', marginTop: 4 }
const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 14, display: 'block' }
const primary = (on: boolean): React.CSSProperties => ({ width: '100%', marginTop: 18, padding: '13px', fontSize: 16, fontWeight: 700, color: '#fff', background: on ? '#f26a1b' : '#9ca3af', border: 'none', borderRadius: 8, cursor: on ? 'pointer' : 'default' })

type Step = 'type' | 'persona' | 'contact' | 'invite' | 'docs'

export default function PreApplyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const [step, setStep] = useState<Step>('type')
  const [type, setType] = useState<string>('')
  const [role, setRole] = useState<string>('')
  const [lang, setLang] = useState<PortalLang>('en')
  const [form, setForm] = useState({ name: '', email: '', phone: '', unit: '' })
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Invited collaborators arrive with a ready token (?t=). Otherwise a staff /
  // email link may prefill ?type=&unit=&name=&email=&lang= and jump to persona.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    setLang(normalizePortalLang(q.get('lang')))
    const t = q.get('t')
    if (t) { setToken(t); setStep('docs'); return }
    const qType = q.get('type') ?? ''
    if (TYPE_DEFS.some(x => x.key === qType)) setType(qType)
    setForm(f => ({ ...f, unit: q.get('unit') ?? f.unit, name: q.get('name') ?? f.name, email: q.get('email') ?? f.email }))
    if (TYPE_DEFS.some(x => x.key === qType)) setStep('persona')
  }, [])

  async function start() {
    setErr(null)
    if (!role) { setErr('Please choose who you are.'); return }
    if (!form.name.trim() || !form.email.includes('@')) { setErr('Please enter your name and a valid email.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/pre-apply/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, type, role, ...form }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not start')
      setToken(d.token); setStep('invite')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (step === 'docs' && token) return <DocsStep code={code} token={token} lang={lang} />

  const s = preApplyStrings(lang)
  const f = preApplyFlow(lang)
  const rtl = isRtl(lang)
  const LangSelect = (
    <select className="pa-lang" value={lang} onChange={e => setLang(e.target.value as PortalLang)} aria-label={s.chooseLang}>
      {PORTAL_LANGS.map(l => <option key={l} value={l}>{PORTAL_LANG_LABEL[l]}</option>)}
    </select>
  )

  return (
    <div className="pa-page" dir={rtl ? 'rtl' : 'ltr'}>
      <style>{WELCOME_CSS}</style>
      <div className="pa-hero">
        <div className="pa-top">
          <div className="pa-brand"><span className="pa-dot" /> PMI Top Florida Properties</div>
          {LangSelect}
        </div>
        <div className="pa-assoc">The Manors of Inverrary XI Condominium Association</div>
        <h1 className="pa-h1">{s.title}</h1>
        {step === 'type' && <><p className="pa-lede">{s.lede}</p><span className="pa-pill">{s.pill}</span></>}
        {step === 'persona' && <p className="pa-lede">{f.personaP}</p>}
        {step === 'contact' && <p className="pa-lede">{s.contactSub}</p>}
        {step === 'invite' && <p className="pa-lede">{f.inviteP}</p>}
      </div>

      {step === 'type' && (
        <>
          <div className="pa-card">
            <div className="pa-eye">🌐 {s.langEye}</div>
            <h2>{s.langH2}</h2><p>{s.langP}</p>
            <div className="pa-langline" dir="ltr">English<i>·</i>Español<i>·</i>Português<i>·</i>Français<i>·</i>Kreyòl<i>·</i>עברית<i>·</i>Русский</div>
          </div>

          <div className="pa-card">
            <div className="pa-sec">
              <div className="pa-shield">🔒</div>
              <div>
                <div className="pa-eye">{s.secEye}</div>
                <h2 style={{ marginTop: 5 }}>{s.secH2}</h2><p>{s.secP}</p>
                <div className="pa-chan"><span className="pa-chip">✉ {s.chEmail}</span><span className="pa-chip">💬 {s.chText}</span><span className="pa-chip">🟢 WhatsApp</span></div>
                <div className="pa-first">{s.first}</div>
              </div>
            </div>
          </div>

          <div className="pa-card">
            <div className="pa-eye">{s.getEye}</div>
            <h2>{s.getH2}</h2><p>{s.getP}</p>
            <div className="pa-types">
              {TYPE_DEFS.map(tp => (
                <button key={tp.key} className={`pa-type${type === tp.key ? ' on' : ''}`} onClick={() => { setType(tp.key); setErr(null) }}>
                  <div className="pa-ic">{tp.icon}</div>
                  <div className="pa-tt">{s[tp.tk]}</div>
                  <div className="pa-td">{s[tp.dk]}</div>
                </button>
              ))}
            </div>
            {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
            <button className="pa-cta" disabled={!type} onClick={() => { if (!type) return; setErr(null); setStep('persona') }}>{s.cta}</button>
          </div>
          <div className="pa-foot">{s.foot}</div>
        </>
      )}

      {step === 'persona' && (
        <div className="pa-card">
          <div className="pa-eye">{f.personaEye}</div>
          <h2>{f.personaH2}</h2>
          <div className="pa-types">
            {ROLE_DEFS.map(rd => (
              <button key={rd.key} className={`pa-type${role === rd.key ? ' on' : ''}`} onClick={() => { setRole(rd.key); setErr(null) }}>
                <div className="pa-ic">{rd.icon}</div>
                <div className="pa-tt">{f[rd.lk]}</div>
                <div className="pa-td">{f[rd.dk]}</div>
              </button>
            ))}
          </div>
          {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
          <button className="pa-cta" disabled={!role} onClick={() => { if (!role) return; setErr(null); setStep('contact') }}>{s.continue2}</button>
          <button onClick={() => setStep('type')} className="pa-link" style={{ display: 'block', margin: '10px auto 0' }}>{s.back}</button>
        </div>
      )}

      {step === 'contact' && (
        <div className="pa-card">
          <div className="pa-eye">{s.contactTitle}</div>
          <label className="pa-lbl">{s.chooseLang}</label>
          <div style={{ marginTop: 5 }}>
            <select className="pa-field" value={lang} onChange={e => setLang(e.target.value as PortalLang)}>
              {PORTAL_LANGS.map(l => <option key={l} value={l}>{PORTAL_LANG_LABEL[l]}</option>)}
            </select>
          </div>
          <label className="pa-lbl">{s.nameL}<input className="pa-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="pa-lbl">{s.emailL}<input className="pa-field" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label className="pa-lbl">{s.phoneL}<input className="pa-field" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} inputMode="tel" /></label>
          <label className="pa-lbl">{s.unitL}<input className="pa-field" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="e.g. 511" /></label>
          {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
          <button className="pa-cta" onClick={start} disabled={busy}>{busy ? '…' : s.continue2}</button>
          <button onClick={() => setStep('persona')} className="pa-link" style={{ display: 'block', margin: '10px auto 0' }}>{s.back}</button>
        </div>
      )}

      {step === 'invite' && token && (
        <div className="pa-card">
          <div className="pa-eye">{f.inviteEye}</div>
          <h2>{f.inviteH2}</h2>
          <CollaboratorAdder token={token} lang={lang} />
          <button className="pa-cta" onClick={() => setStep('docs')}>{f.invContinue}</button>
        </div>
      )}
    </div>
  )
}

// ── Add collaborators (name / email / role) + email each their own link ──────
function CollaboratorAdder({ token, lang, onAdded, compact }: { token: string; lang: PortalLang; onAdded?: () => void; compact?: boolean }) {
  const f = preApplyFlow(lang)
  const [rows, setRows] = useState<{ name: string; email: string; role: string }[]>([{ name: '', email: '', role: '' }])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const set = (i: number, k: 'name' | 'email' | 'role', v: string) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const valid = rows.filter(r => r.name.trim() && r.email.includes('@') && r.role)

  async function send() {
    setErr(null); setMsg(null)
    if (valid.length === 0) { setErr('Add at least one person with a name, valid email, and role.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/pre-apply/${token}/collaborators`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collaborators: valid }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not send')
      setMsg(f.invSent); setRows([{ name: '', email: '', role: '' }]); onAdded?.()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: compact ? 4 : 8 }}>
      {rows.map((r, i) => (
        <div className="pa-collab-row" key={i}>
          <input className="pa-field" style={{ marginTop: 0 }} placeholder={f.invNameL} value={r.name} onChange={e => set(i, 'name', e.target.value)} />
          <input className="pa-field" style={{ marginTop: 0 }} type="email" placeholder={f.invEmailL} value={r.email} onChange={e => set(i, 'email', e.target.value)} />
          <select className="pa-field" style={{ marginTop: 0 }} value={r.role} onChange={e => set(i, 'role', e.target.value)}>
            <option value="">{f.invRolePick}</option>
            {ROLE_DEFS.map(rd => <option key={rd.key} value={rd.key}>{f[rd.lk]}</option>)}
          </select>
          {rows.length > 1
            ? <button className="pa-x pa-rm" title="Remove" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>×</button>
            : <span />}
        </div>
      ))}
      <button className="pa-ghost" onClick={() => setRows(rs => [...rs, { name: '', email: '', role: '' }])}>{f.invAdd}</button>
      {err && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>⚠ {err}</p>}
      {msg && <p style={{ color: '#166534', fontSize: 13, marginTop: 10 }}>✓ {msg}</p>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={send} disabled={busy || valid.length === 0} style={{ padding: '11px 18px', fontSize: 14, fontWeight: 700, color: '#fff', background: busy || valid.length === 0 ? '#c9ccd3' : '#1f2a44', border: 'none', borderRadius: 10, cursor: busy || valid.length === 0 ? 'default' : 'pointer' }}>{busy ? f.invSending : f.invSend}</button>
        {!compact && <span className="pa-link" style={{ color: '#9aa0ab', fontSize: 12.5 }}>{f.invSkip}</span>}
      </div>
    </div>
  )
}

function DocsStep({ code, token, lang }: { code: string; token: string; lang: PortalLang }) {
  const f = preApplyFlow(lang)
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [rulesName, setRulesName] = useState('')
  const [sig, setSig] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<null | { appSubmitted: boolean }>(null)

  const load = useCallback(() => {
    fetch(`/api/pre-apply/${token}`).then(r => r.json()).then(d => { if (d.error) setErr(d.error); else setInfo(d) }).catch(() => setErr('Network error — please reload.'))
  }, [token])
  useEffect(load, [load])

  async function submit() {
    setErr(null)
    if (info?.me.signs) {
      if (!agreed) { setErr('Please check the box to acknowledge the rules.'); return }
      if (!rulesName.trim()) { setErr('Please type your name to sign.'); return }
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/pre-apply/${token}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rulesName, signatureImage: sig }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not submit')
      setDone({ appSubmitted: !!d.appSubmitted })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (err && !info) return <div style={wrap}><h2>⚠ {err}</h2></div>
  if (!info) return <div style={wrap}><p>{f.uploadingBtn === 'Uploading…' ? 'Loading…' : '…'}</p></div>

  const alreadyDone = done || info.me.status === 'completed'
  if (alreadyDone) {
    const appSubmitted = done?.appSubmitted ?? info.submitted
    return (
      <div style={wrap}>
        <h1 style={{ color: '#f26a1b' }}>✅ {appSubmitted ? f.doneSubmittedH : f.doneH}</h1>
        <p>{appSubmitted ? f.doneSubmittedP : f.doneP}</p>
        <p style={{ color: '#6b7280', fontSize: 13, marginTop: 18 }}>{f.questions}</p>
      </div>
    )
  }

  const myDocs = info.checklist.filter(d => d.mine)
  const otherDocs = info.checklist.filter(d => !d.mine)
  const myRequiredDone = myDocs.every(d => !d.required || d.uploaded)
  const canSubmit = myRequiredDone && (!info.me.signs || (agreed && !!rulesName.trim()))

  // Verify email first (per person).
  if (!info.me.emailVerified) return (
    <div style={wrap}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{info.associationName}</p>
      <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 2px' }}>{f.verifyH1}</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>{f.verifyP}{info.me.emailMasked ? ` (${info.me.emailMasked})` : ''}</p>
      <VerifyEmail token={token} lang={lang} onVerified={load} />
    </div>
  )

  return (
    <div style={wrap}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#6b7280', margin: 0 }}>{info.associationName}</p>
      <h1 style={{ fontSize: 22, color: '#1f2a44', margin: '4px 0 2px' }}>{f.docsH1}</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 0 }}>
        {info.me.roleLabel}{info.unitLabel ? ` · Unit ${info.unitLabel}` : ''} · {f.docsP}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {myDocs.length === 0
          ? <p style={{ fontSize: 13, color: '#6b7280' }}>{f.noDocsForYou}</p>
          : myDocs.map(d => <DocBox key={d.id} token={token} item={d} lang={lang} onDone={load} />)}
      </div>

      {otherDocs.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, color: '#1f2a44', margin: '20px 0 4px' }}>{f.otherDocsH}</h2>
          <p style={{ fontSize: 12.5, color: '#6b7280', marginTop: 0 }}>{f.otherDocsP}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {otherDocs.map(d => <DocBox key={d.id} token={token} item={d} lang={lang} onDone={load} />)}
          </div>
        </>
      )}

      {/* Lead only: see who's on the application + add more collaborators */}
      {info.canAddCollaborators && (
        <div style={{ marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fafbfc' }}>
          <h2 style={{ fontSize: 15, color: '#1f2a44', margin: '0 0 8px' }}>{f.peopleH}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {info.collaborators.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#374151', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span><strong>{c.name || c.email || '—'}</strong> <span style={{ color: '#6b7280' }}>· {c.roleLabel}</span>{c.isPrimary && <span style={{ color: '#9ca3af' }}> · {f.youBadge}</span>}{c.signs && <span style={{ color: '#9ca3af' }}> · {f.signsBadge}</span>}</span>
                <span style={{ fontWeight: 600, color: c.status === 'completed' ? '#166534' : '#92400e' }}>{statusLabel(c.status, f)}{c.signed ? ' ✍' : ''}</span>
              </div>
            ))}
          </div>
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#1f2a44', fontWeight: 600, fontSize: 13.5 }}>{f.addSomeone}</summary>
            <CollaboratorAdder token={token} lang={lang} onAdded={load} compact />
          </details>
        </div>
      )}

      {/* Rules — signed only by tenants/buyers and owners */}
      {info.me.signs ? (
        <>
          <h2 style={{ fontSize: 15, color: '#1f2a44', margin: '22px 0 4px' }}>{f.rulesH}</h2>
          {info.rules.length > 0 ? (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
              {info.rules.map(r => <li key={r.rule_key}>{r.label}</li>)}
            </ul>
          ) : <p style={{ fontSize: 13, color: '#6b7280' }}>{f.rulesFallback}</p>}

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, fontSize: 13.5, color: '#374151', lineHeight: 1.5 }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{f.agreeLine}</span>
          </label>
          <label style={label}>{f.signNameL}<input style={field} value={rulesName} onChange={e => setRulesName(e.target.value)} /></label>
          <div style={{ marginTop: 12 }}>
            <label style={{ ...label, marginTop: 0 }}>{f.drawSig}</label>
            <SignaturePad onChange={img => setSig(img ?? '')} />
          </div>
        </>
      ) : (
        <p style={{ marginTop: 22, fontSize: 13, color: '#0f7a4d', background: '#f0fdf6', border: '1px solid #cdeedd', borderRadius: 9, padding: '10px 12px' }}>{f.noSignNote}</p>
      )}

      {!myRequiredDone && <p style={{ color: '#92400e', fontSize: 12.5, marginTop: 12 }}>{f.uploadAllNote}</p>}
      {err && <p style={{ color: '#b91c1c', fontSize: 14, marginTop: 12 }}>⚠ {err}</p>}
      <button onClick={submit} disabled={busy || !canSubmit} style={primary(!busy && canSubmit)}>{busy ? f.submittingBtn : f.submitMyPart}</button>
      <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 12, textAlign: 'center' }}>PMI Top Florida Properties · {code}</p>
    </div>
  )
}

function statusLabel(status: string, f: ReturnType<typeof preApplyFlow>): string {
  if (status === 'completed') return f.statusCompleted
  if (status === 'invited') return f.statusInvited
  if (status === 'active') return f.statusActive
  return f.statusStarted
}

function VerifyEmail({ token, lang, onVerified }: { token: string; lang: PortalLang; onVerified: () => void }) {
  const f = preApplyFlow(lang)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/pre-apply/${token}/send-otp`, { method: 'POST' })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not send')
      setSent(true); setMsg(`${f.codeSentTo} ${d.sentTo}.`)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  async function verify() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/pre-apply/${token}/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not verify')
      onVerified()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const btn: React.CSSProperties = { padding: '10px 16px', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', color: '#fff', background: busy ? '#9ca3af' : '#f26a1b' }
  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={send} disabled={busy} style={btn}>{sent ? f.resendCode : f.sendCode}</button>
      {sent && <>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={f.codePlaceholder} inputMode="numeric" style={{ width: 130, padding: '10px 12px', fontSize: 16, border: '1px solid #d1d5db', borderRadius: 8, letterSpacing: 3 }} />
        <button onClick={verify} disabled={busy || code.length < 4} style={{ ...btn, background: busy || code.length < 4 ? '#9ca3af' : '#059669' }}>{f.verifyBtn}</button>
      </>}
      {msg && <p style={{ width: '100%', fontSize: 13, color: msg.startsWith(f.codeSentTo) ? '#166534' : '#b91c1c', margin: '4px 0 0' }}>{msg}</p>}
    </div>
  )
}

function DocBox({ token, item, lang, onDone }: { token: string; item: ChecklistItem; lang: PortalLang; onDone: () => void }) {
  const f = preApplyFlow(lang)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit() {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const u = await fetch(`/api/pre-apply/${token}/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_key: item.doc_key, filename: file.name }) })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'upload failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      const s = await fetch(`/api/pre-apply/${token}/record-doc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_key: item.doc_key, doc_label: item.label, storage_path: uj.path, filename: file.name, mime_type: file.type }) })
      if (!s.ok) throw new Error((await s.json()).error || 'save failed')
      setFile(null); onDone()
    } catch (e) { setMsg(`Could not upload: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px solid ${item.uploaded ? '#a7f3d0' : (item.required ? '#fde68a' : '#e5e7eb')}`, background: item.uploaded ? '#ecfdf5' : (item.required ? '#fffbeb' : '#fff'), borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</span>
          {!item.required && <span style={{ fontSize: 11, color: '#6b7280' }}> · {f.optional}</span>}
          {item.note && <div style={{ fontSize: 12, color: '#6b7280' }}>{item.note}</div>}
        </div>
        {item.uploaded && <span style={{ fontSize: 12.5, color: '#166534', fontWeight: 600 }}>✓ {f.uploadedTag}</span>}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
        <button onClick={submit} disabled={!file || busy} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: !file || busy ? 'default' : 'pointer', background: !file || busy ? '#d1d5db' : '#f26a1b', color: '#fff', fontSize: 13, fontWeight: 700 }}>{busy ? f.uploadingBtn : item.uploaded ? f.replaceBtn : f.uploadBtn}</button>
      </div>
      {msg && <p style={{ fontSize: 12, color: '#991b1b', margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}
