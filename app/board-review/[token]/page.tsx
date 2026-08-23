'use client'

// The board / on-site manager review page. One link per round, shared by every
// approver; ANY ONE of them settles a document.
//
// Three rules the layout enforces rather than merely states:
//  · a document that has not been uploaded shows NO buttons — there is nothing
//    to open, so it cannot be "pending a decision";
//  · every decision is stamped with WHO and WHEN, visible on the row;
//  · a refusal cannot be saved without a reason, because the applicant reads it
//    and "incomplete" tells them nothing.

import { use, useCallback, useEffect, useState } from 'react'

type DocState = 'waiting' | 'received' | 'approved' | 'refused'
interface Row {
  scopeKey: string; docKey: string; label: string; providedBy: string; required: boolean
  perApplicantName: string | null; state: DocState; documentId: string | null; filename: string | null
  decision: { by: string; role: string; at: string; reason: string | null } | null
}
interface Info {
  associationName: string; unitLabel: string | null; applicationType: string | null
  applicants: string[]; note: string | null
  reviewers: { name: string; role: string }[]
  roleLabels: Record<string, string>
  windowSentence: string
  rows: Row[]
  totals: { required: number; received: number; decided: number; approved: number; refused: number; waiting: number }
  complete: boolean; windowOpenedAt: string | null; windowDays: number; dueAt: string | null
}

const TYPE: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '26px 18px 70px', fontFamily: 'system-ui, sans-serif', color: '#16202f' }
const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden' }
const btn = (kind: 'view' | 'ok' | 'no', on: boolean): React.CSSProperties => ({
  font: '600 13px system-ui', borderRadius: 8, padding: '8px 13px', cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${on ? (kind === 'ok' ? '#0f7a4d' : '#b42318') : kind === 'view' ? '#1f2a44' : '#d1d5db'}`,
  background: on ? (kind === 'ok' ? '#0f7a4d' : '#b42318') : '#fff',
  color: on ? '#fff' : kind === 'view' ? '#1f2a44' : '#4a5265',
})

export default function BoardReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [me, setMe] = useState<{ name: string; role: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [why, setWhy] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/board-review/${token}`).then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setInfo(d) })
      .catch(() => setErr('Network error — please reload.'))
  }, [token])
  useEffect(load, [load])

  async function decide(row: Row, decision: 'approved' | 'refused') {
    if (!me) { setErr('Please tell us who you are first.'); return }
    const reason = (why[row.scopeKey] ?? '').trim()
    if (decision === 'refused' && reason.length < 4) {
      // First click OPENS the box rather than scolding — the reason is the
      // point of refusing, so ask for it before complaining about it.
      const opened = why[row.scopeKey] !== undefined
      setWhy(w => ({ ...w, [row.scopeKey]: w[row.scopeKey] ?? '' }))
      setErr(opened ? `Please say briefly why “${row.label}” is refused — the applicant reads this.` : null)
      return
    }
    setBusy(row.scopeKey); setErr(null)
    try {
      const r = await fetch(`/api/board-review/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeKey: row.scopeKey, decision, reason, reviewer: me }),
      })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not save')
      load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  // The reviewer's OVERALL verdict — separate from each document's own
  // Approve/Refuse. "Send Back" always needs the note open first (same
  // two-step as a per-document refuse); "Approve" only needs it when
  // everything isn't already decided. User direction, 2026-08-22.
  const [finalNoteOpen, setFinalNoteOpen] = useState(false)
  const [finalNote, setFinalNote] = useState('')
  const [finalBusy, setFinalBusy] = useState(false)
  const [finalMsg, setFinalMsg] = useState<string | null>(null)

  async function finalize(action: 'approve' | 'send_back') {
    if (!me) { setErr('Please tell us who you are first.'); return }
    if (action === 'send_back' && !finalNoteOpen) { setFinalNoteOpen(true); return }
    if (action === 'send_back' && finalNote.trim().length < 4) { setErr('Say briefly what needs to change — the office reads this.'); return }
    setFinalBusy(true); setErr(null); setFinalMsg(null)
    try {
      const r = await fetch(`/api/board-review/${token}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewer: me, note: finalNote.trim() }),
      })
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not save')
      if (action === 'send_back') { setFinalMsg('Sent back — the office has been emailed.'); setFinalNoteOpen(false); setFinalNote('') }
      else if (d.interviewRequested) setFinalMsg('Approved — this association requires an interview before the letter can go out. The buyer/tenant has been introduced to the board by email to schedule one; the approval letter follows once that’s done.')
      else setFinalMsg(d.alreadySent ? 'The approval letter was already created and sent for signature.' : 'Approved — the approval letter has been created and sent for signature.')
      load()
    } catch (e) { setErr((e as Error).message) } finally { setFinalBusy(false) }
  }

  if (err && !info) return <div style={wrap}><h2 style={{ color: '#b42318' }}>⚠ {err}</h2></div>
  if (!info) return <div style={wrap}><p style={{ color: '#7c8496' }}>Loading…</p></div>

  const t = info.totals
  return (
    <div style={wrap}>
      <p style={{ font: '600 11.5px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: '#f26a1b', margin: 0 }}>{info.associationName}</p>
      <h1 style={{ font: '600 27px/1.2 Georgia, serif', margin: '8px 0 0', color: '#16202f' }}>
        Documents to review{info.unitLabel ? ` — Unit ${info.unitLabel}` : ''}
      </h1>
      <p style={{ color: '#4a5265', fontSize: 15, marginTop: 8 }}>
        {info.applicants.join(' and ') || 'The applicant'}
        {info.applicationType ? ` · ${TYPE[info.applicationType] ?? info.applicationType}` : ''}
      </p>
      {info.note && <p style={{ fontSize: 14.5, color: '#4a5265', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 9, padding: '11px 13px' }}>{info.note}</p>}

      <div style={{ borderLeft: '3px solid #f26a1b', background: '#fff3e9', borderRadius: '0 9px 9px 0', padding: '13px 16px', margin: '16px 0 20px' }}>
        <p style={{ margin: 0, fontSize: 14.5, color: '#16202f' }}>{info.windowSentence}</p>
      </div>

      {/* Who is deciding. Recorded on every row, so it is asked once, up front. */}
      <div style={{ ...card, padding: 16, marginBottom: 18 }}>
        <div style={{ font: '600 13px system-ui', marginBottom: 9 }}>Who is reviewing?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {info.reviewers.map(r => {
            const on = me?.name === r.name
            return (
              <button key={r.name} onClick={() => setMe(r)}
                style={{ font: '600 13px system-ui', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', textAlign: 'left',
                  border: `1.5px solid ${on ? '#f26a1b' : '#e2e5ec'}`, background: on ? '#fff7f0' : '#fff', color: '#16202f' }}>
                {r.name}
                <span style={{ display: 'block', font: '400 11.5px system-ui', color: '#7c8496', marginTop: 2 }}>{info.roleLabels[r.role] ?? r.role}</span>
              </button>
            )
          })}
        </div>
        {!me && <p style={{ fontSize: 12.5, color: '#b45309', margin: '10px 0 0' }}>Pick your name — every approval is recorded against it.</p>}
      </div>

      {err && <p style={{ color: '#b42318', fontSize: 14, background: '#fdf2f0', border: '1px solid #f3c9c3', borderRadius: 8, padding: '10px 12px' }}>⚠ {err}</p>}

      <div style={card}>
        {info.rows.map((row, i) => {
          const waiting = row.state === 'waiting'
          // A document staff already approved/refused while pre-checking
          // incoming files is not the same as a BOARD member (or the on-site
          // manager) having actually looked at it. Real case, 2026-08-22
          // (MANXI 303): every document was staff pre-audited before this
          // round even existed, and the page showed the board a screen that
          // was already "done" — green buttons, "Approved by" — with nothing
          // left for them to actually decide. Until a reviewer picked from
          // "Who is reviewing?" makes their OWN call on a row, it renders as
          // if undecided; clicking Approve/Refuse here overwrites the staff
          // decision with a real, attributed board one (same upsert either way).
          const boardDecided = !!row.decision && row.decision.role !== 'staff'
          const flag = !boardDecided ? (waiting ? '⚪' : '🟠')
            : row.state === 'approved' ? '🟢' : row.state === 'refused' ? '🔴' : '🟠'
          const bg = boardDecided ? (row.state === 'approved' ? '#eef8f2' : row.state === 'refused' ? '#fdf2f0' : undefined) : undefined
          return (
            <div key={row.scopeKey} style={{
              padding: '13px 16px', borderTop: i ? '1px solid #f1ede6' : undefined, background: bg,
              backgroundImage: waiting ? 'repeating-linear-gradient(135deg,transparent,transparent 9px,#f4f2ee 9px,#f4f2ee 10px)' : undefined,
            }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 240px', minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: waiting ? '#7c8496' : '#16202f' }}>
                    {row.label}{row.perApplicantName ? ` — ${row.perApplicantName}` : ''}
                    {!row.required && <span style={{ font: '400 12px system-ui', color: '#7c8496' }}> · optional</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#7c8496', marginTop: 2 }}>
                    {waiting ? 'Not uploaded yet — nothing to open' : (row.filename ?? 'On file')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                  {waiting ? (
                    <span style={{ font: '600 12.5px system-ui', color: '#7c8496' }}>Nothing to review</span>
                  ) : (
                    <>
                      <button onClick={() => setOpen(open === row.scopeKey ? null : row.scopeKey)} style={btn('view', false)}>
                        {open === row.scopeKey ? '✕ Close' : '👁 View'}
                      </button>
                      <button disabled={busy === row.scopeKey} onClick={() => decide(row, 'approved')} style={btn('ok', boardDecided && row.state === 'approved')}>Approve</button>
                      <button disabled={busy === row.scopeKey} onClick={() => decide(row, 'refused')} style={btn('no', boardDecided && row.state === 'refused')}>Refuse</button>
                    </>
                  )}
                  <span style={{ fontSize: 19, width: 22, textAlign: 'center' }}>{flag}</span>
                </div>
              </div>

              {open === row.scopeKey && row.documentId && (
                <div style={{ marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 9, overflow: 'hidden' }}>
                  <iframe src={`/api/board-review/${token}/doc/${row.documentId}`} title={row.label}
                    style={{ width: '100%', height: 460, border: 'none', background: '#f4f2ee' }} />
                </div>
              )}

              {row.decision && (
                <div style={{ marginTop: 7, fontSize: 13, color: '#4a5265' }}>
                  {!boardDecided
                    ? <><span>🔎</span> <strong>AI Pre-Audited by Maia</strong></>
                    : <>{row.state === 'approved' ? '🟢' : '🔴'} <strong>{row.state === 'approved' ? 'Approved' : 'Refused'} by {row.decision.by}</strong></>}
                  {' · '}<span style={{ color: '#7c8496', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.decision.at)}</span>
                  {row.decision.reason && (
                    <div style={{ marginTop: 5, borderLeft: '3px solid #b42318', paddingLeft: 9, color: '#16202f' }}>“{row.decision.reason}”</div>
                  )}
                </div>
              )}

              {!waiting && (why[row.scopeKey] !== undefined || row.state === 'refused') && row.state !== 'approved' && (
                <div style={{ marginTop: 8 }}>
                  <textarea value={why[row.scopeKey] ?? ''} onChange={e => setWhy(w => ({ ...w, [row.scopeKey]: e.target.value }))}
                    autoFocus
                    placeholder="Why is this refused? The applicant reads it — e.g. signed but not notarized."
                    style={{ width: '100%', boxSizing: 'border-box', font: '14px system-ui', color: '#16202f', border: '1px solid #b42318', borderRadius: 8, padding: '9px 11px', minHeight: 52, resize: 'vertical' }} />
                  <div style={{ font: '12px system-ui', color: '#7c8496', marginTop: 4 }}>Press <b>Refuse</b> again to send it back with this reason.</div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* The clock, stated in the same words as the rule. */}
      <div style={{ ...card, marginTop: 14, padding: '15px 17px', display: 'flex', gap: 13, alignItems: 'flex-start' }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', marginTop: 6, flex: 'none', background: info.complete ? '#0f7a4d' : '#b45309' }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: info.complete ? '#0f7a4d' : '#b45309' }}>
            {info.complete && info.dueAt
              ? `Window open — a decision is due ${fmt(info.dueAt)}`
              : `Clock not started — ${t.decided} of ${t.received} reviewed${t.waiting ? `, ${t.waiting} still to arrive` : ''}`}
          </div>
          <div style={{ fontSize: 14, color: '#4a5265', marginTop: 3 }}>
            {info.complete
              ? `Every document has been received and approved. The approval letter is next, and anyone who has not signed is reminded every 5 days.`
              : t.waiting > 0
                ? `The ${info.windowDays}-day window begins when the last requested document is received and reviewed.`
                : t.refused > 0
                  ? `${t.refused} document${t.refused === 1 ? ' was' : 's were'} refused — the window stays shut until ${t.refused === 1 ? 'it is' : 'they are'} replaced.`
                  : `${t.required - t.decided} still to review.`}
          </div>
        </div>
      </div>

      {/* The reviewer's overall verdict — separate from each document's own
          Approve/Refuse above. User direction, 2026-08-22: "Send Back or
          Approve — send back opens a text for them to fill and send me
          back an email with the items not approved and the text - or if
          approved generates and send already the approval letter for
          signature." */}
      <div style={{ ...card, marginTop: 14, padding: '15px 17px' }}>
        <div style={{ font: '600 13px system-ui', marginBottom: 10 }}>Your overall decision</div>
        {finalMsg ? (
          <p style={{ font: '600 14px system-ui', color: '#0f7a4d', margin: 0 }}>✓ {finalMsg}</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button disabled={finalBusy} onClick={() => finalize('send_back')}
                style={{ font: '600 13.5px system-ui', borderRadius: 8, padding: '10px 16px', cursor: finalBusy ? 'default' : 'pointer', border: '1px solid #b42318', background: '#fff', color: '#b42318' }}>
                Send Back
              </button>
              <button disabled={finalBusy || !info.complete} onClick={() => finalize('approve')}
                title={!info.complete ? 'Decide every document above first' : undefined}
                style={{ font: '600 13.5px system-ui', borderRadius: 8, padding: '10px 16px', cursor: finalBusy || !info.complete ? 'default' : 'pointer', border: 'none', background: info.complete ? '#0f7a4d' : '#c9ccd3', color: '#fff' }}>
                {finalBusy ? 'Working…' : 'Approve'}
              </button>
            </div>
            {!info.complete && <p style={{ font: '12.5px system-ui', color: '#7c8496', margin: '8px 0 0' }}>Approve becomes available once every document above is decided.</p>}
            {finalNoteOpen && (
              <div style={{ marginTop: 10 }}>
                <textarea value={finalNote} onChange={e => setFinalNote(e.target.value)} autoFocus
                  placeholder="What needs to change? This goes straight to the office, along with anything currently refused."
                  style={{ width: '100%', boxSizing: 'border-box', font: '14px system-ui', color: '#16202f', border: '1px solid #b42318', borderRadius: 8, padding: '9px 11px', minHeight: 70, resize: 'vertical' }} />
                <div style={{ font: '12px system-ui', color: '#7c8496', marginTop: 4 }}>Press <b>Send Back</b> again to send it.</div>
              </div>
            )}
          </>
        )}
      </div>

      <p style={{ color: '#9aa0ab', fontSize: 12, marginTop: 20, textAlign: 'center' }}>
        PMI Top Florida Properties · every decision is recorded with your name and the time
      </p>
    </div>
  )
}
