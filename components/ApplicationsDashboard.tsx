'use client'

// =====================================================================
// components/ApplicationsDashboard.tsx
//
// One dashboard, three desks: PMI staff, a board member, the on-site manager.
//
// They share a component for the same reason they share lib/board-review.ts —
// if the board's screen and the office's screen can disagree about whether an
// application is late, somebody will act on the wrong one. What differs is
// only emphasis: each viewer's own stages are named "Your turn" and sort to
// the top, and the board and on-site manager get the review link they were
// actually sent rather than the staff audit screen they cannot open.
//
// Every row answers one question — who owes the next action, and for how long
// have they owed it.
// =====================================================================

import { useCallback, useEffect, useState } from 'react'

type Stage = 'applicant' | 'refused' | 'not_sent' | 'review' | 'letter' | 'signature' | 'decided'
type Owner = 'applicant' | 'staff' | 'board'
type Alarm = 'overdue' | 'due_soon' | 'stalled'
export type DashboardRole = 'staff' | 'board' | 'onsite_manager'

interface Row {
  id: string; associationCode: string; associationName: string; unit: string | null
  type: string; status: string; applicants: string[]; driveFolderUrl: string | null
  stage: Stage; owner: Owner; detail: string; outstanding: string[]
  sinceAt: string | null; waitingDays: number | null
  windowOpenedAt: string | null; dueAt: string | null; daysLeft: number | null
  alarm: Alarm | null
  totals: { required: number; received: number; decided: number; approved: number; refused: number; waiting: number }
  reviewUrl: string | null; reviewSentAt: string | null
  letter: { status: string; signed: number; of: number } | null
}
interface Payload {
  /** The server decides which desk this is — the board portal serves both a
   *  board member and the on-site manager from one page. */
  role?: DashboardRole
  rows: Row[]
  counts: Record<Stage, number>
  alarms: { overdue: number; dueSoon: number; stalled: number }
  stageLabels: Record<Stage, string>
  stageOwners: Record<Stage, Owner>
  stageOrder: Stage[]
  error?: string
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }

// Colour carries meaning here, so it is defined once: warm = somebody outside
// is holding it, blue = it is with a reviewer, green = finished.
const STAGE_STYLE: Record<Stage, { c: string; b: string; dot: string }> = {
  refused:   { c: '#991b1b', b: '#fee2e2', dot: '🔴' },
  not_sent:  { c: '#92400e', b: '#fef3c7', dot: '📤' },
  review:    { c: '#1e40af', b: '#dbeafe', dot: '🔎' },
  letter:    { c: '#5b21b6', b: '#ede9fe', dot: '📝' },
  signature: { c: '#5b21b6', b: '#ede9fe', dot: '✍️' },
  applicant: { c: '#854d0e', b: '#fef9c3', dot: '⏳' },
  decided:   { c: '#166534', b: '#dcfce7', dot: '✅' },
}

/** Which stages this desk is responsible for DRIVING — not the same thing as
 *  who must produce the next document (that is the row's `owner`).
 *
 *  A refusal is owned by the applicant, who has to supply a replacement, but it
 *  is the office that has to send it back to them with the reason attached — so
 *  it is staff's turn. Staff are deliberately NOT given every `applicant` row:
 *  if "your turn" includes each application anyone is still uploading into, it
 *  stops meaning anything.
 *
 *  The on-site manager reviews documents but does not sign the Board Decision,
 *  which is why `signature` is the board's alone. */
const MINE: Record<DashboardRole, Stage[]> = {
  staff: ['refused', 'not_sent', 'letter'],
  board: ['review', 'signature'],
  onsite_manager: ['review'],
}

/** Whether this row is the viewer's to act on now.
 *
 *  Beyond their own stages, an application that has gone QUIET is the office's
 *  to chase — nobody else will. Without this the staff dashboard reports "your
 *  turn: 0" on a portfolio where every application is stuck waiting on an
 *  applicant nobody has nudged, which is the exact failure it was built to
 *  catch. The board is not given the same rule: a document that has not
 *  arrived is not theirs to chase. */
function isMine(role: DashboardRole, r: Row): boolean {
  if (MINE[role].includes(r.stage)) return true
  return role === 'staff' && r.stage !== 'decided' && r.alarm != null
}

const ROLE_TITLE: Record<DashboardRole, string> = {
  staff: 'Applications — where each one stands',
  board: 'Applications for your board',
  onsite_manager: 'Applications for your building',
}
const ROLE_BLURB: Record<DashboardRole, string> = {
  staff: 'Every open application, by whose turn it is. The office owns the amber and purple stages.',
  board: 'What is waiting on the board, and how long the association has left to decide.',
  onsite_manager: 'What is waiting on you to review. Any one approver settles a document.',
}

const fmtDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
  : '—'

/** "waiting 3 days" reads better than a date when the number is the point. */
function waited(days: number | null): string {
  if (days == null) return ''
  if (days <= 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export default function ApplicationsDashboard({ endpoint, role: roleProp, onOpen }: {
  endpoint: string
  /** Fallback only — the response's own `role` wins, so the board portal does
   *  not have to guess which persona is logged in before it can render. */
  role: DashboardRole
  /** Board/manager view: open the row's detail in the list below. */
  onOpen?: (id: string) => void
}) {
  const [d, setD] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage | 'mine' | null>(null)
  const [showDecided, setShowDecided] = useState(false)

  const load = useCallback(() => {
    fetch(endpoint, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setD).catch(e => setErr(String(e.message ?? e)))
  }, [endpoint])
  useEffect(load, [load])

  if (err) return <p style={{ color: '#991b1b', font: '13px system-ui' }}>⚠ {err}</p>
  if (!d) return <p style={{ color: '#9ca3af', font: '13px system-ui' }}>Reading the pipeline…</p>

  const role = d.role ?? roleProp
  const mineStages = MINE[role]
  const mineCount = d.rows.filter(r => isMine(role, r)).length
  const open = d.rows.filter(r => r.stage !== 'decided')

  const shown = d.rows.filter(r => {
    if (r.stage === 'decided' && !showDecided) return false
    if (stage === 'mine') return isMine(role, r)
    if (stage) return r.stage === stage
    return true
  })

  // The viewer's own stages first, then everything else that is in play.
  const chipStages = [...mineStages, ...d.stageOrder.filter(s => !mineStages.includes(s) && s !== 'decided')]
    .filter(s => (d.counts[s] ?? 0) > 0 || mineStages.includes(s))

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ font: '700 17px system-ui', margin: 0, color: '#111827' }}>{ROLE_TITLE[role]}</h2>
          <p style={{ font: '13px system-ui', color: '#6b7280', margin: '3px 0 0' }}>{ROLE_BLURB[role]}</p>
        </div>
        <button onClick={load} style={{ font: '600 12px system-ui', color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      {/* What needs attention now. Silent when nothing does — an alarm that is
          always on is not an alarm. */}
      {(d.alarms.overdue > 0 || d.alarms.dueSoon > 0 || d.alarms.stalled > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 0' }}>
          {d.alarms.overdue > 0 && <Alarm c="#991b1b" b="#fee2e2" bd="#fca5a5">⚠ {d.alarms.overdue} past the decision window</Alarm>}
          {d.alarms.dueSoon > 0 && <Alarm c="#92400e" b="#fef3c7" bd="#fcd34d">⏱ {d.alarms.dueSoon} due within a week</Alarm>}
          {d.alarms.stalled > 0 && <Alarm c="#3730a3" b="#eef2ff" bd="#c7d2fe">💤 {d.alarms.stalled} with no movement in 2 weeks</Alarm>}
        </div>
      )}

      {/* Stage filter. "Your turn" is first because it is the reason to look. */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        <Chip on={stage === 'mine'} onClick={() => setStage(stage === 'mine' ? null : 'mine')} c="#0f766e" b="#ccfbf1">
          👉 Your turn · {mineCount}
        </Chip>
        <Chip on={stage === null} onClick={() => setStage(null)} c="#374151" b="#f3f4f6">All open · {open.length}</Chip>
        {chipStages.map(s => (
          <Chip key={s} on={stage === s} onClick={() => setStage(stage === s ? null : s)} c={STAGE_STYLE[s].c} b={STAGE_STYLE[s].b}>
            {STAGE_STYLE[s].dot} {d.stageLabels[s]} · {d.counts[s] ?? 0}
          </Chip>
        ))}
        {(d.counts.decided ?? 0) > 0 && (
          <Chip on={showDecided} onClick={() => setShowDecided(v => !v)} c="#166534" b="#dcfce7">
            ✅ Decided · {d.counts.decided}
          </Chip>
        )}
      </div>

      {shown.length === 0 ? (
        <p style={{ font: '13px system-ui', color: '#9ca3af', margin: '14px 0' }}>
          {stage === 'mine' ? 'Nothing is waiting on you.' : 'No applications here.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
          {shown.map(r => <RowCard key={r.id} r={r} role={role} mine={isMine(role, r)} onOpen={onOpen} labels={d.stageLabels} />)}
        </div>
      )}
    </div>
  )
}

function Alarm({ c, b, bd, children }: { c: string; b: string; bd: string; children: React.ReactNode }) {
  return <span style={{ font: '600 12.5px system-ui', color: c, background: b, border: `1px solid ${bd}`, borderRadius: 8, padding: '5px 11px' }}>{children}</span>
}

function Chip({ on, onClick, c, b, children }: { on: boolean; onClick: () => void; c: string; b: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      font: '600 12.5px system-ui', cursor: 'pointer', borderRadius: 999, padding: '5px 12px',
      border: on ? `2px solid ${c}` : '1px solid #e5e7eb', background: on ? b : '#fff', color: on ? c : '#4b5563',
    }}>{children}</button>
  )
}

function RowCard({ r, role, mine, onOpen, labels }: {
  r: Row; role: DashboardRole; mine: boolean; onOpen?: (id: string) => void; labels: Record<Stage, string>
}) {
  const st = STAGE_STYLE[r.stage]
  const who = [r.applicants[0] ?? 'Applicant', r.applicants.length > 1 ? `+${r.applicants.length - 1}` : ''].filter(Boolean).join(' ')

  // Staff go to the audit screen; a board member or on-site manager goes to the
  // link they were actually sent, which is the only place they can decide. The
  // approval letter is NOT linked here — its signing links are per-signer and
  // are minted into the email each signer received, so one cannot be handed out
  // from a shared screen.
  const href = role === 'staff'
    ? `/admin/pre-apply/${r.id}`
    : (r.reviewUrl && (r.stage === 'review' || r.stage === 'refused') ? r.reviewUrl : null)
  const external = role !== 'staff' && !!href

  return (
    <div style={{
      border: `1px solid ${mine ? st.c : '#e5e7eb'}`,
      borderLeft: `4px solid ${mine ? st.c : '#e5e7eb'}`,
      borderRadius: 10, background: '#fff', padding: '11px 13px',
      display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 0, flex: '1 1 340px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ font: '700 14.5px system-ui', color: '#111827' }}>{who}</span>
          <span style={{ font: '13px system-ui', color: '#6b7280' }}>
            {role === 'staff' ? `${r.associationCode} · ` : ''}{r.unit ? `Unit ${r.unit} · ` : ''}{TYPE_LABEL[r.type] ?? r.type}
          </span>
        </div>
        <div style={{ font: '13px system-ui', color: '#374151', marginTop: 4 }}>{r.detail}</div>
        <div style={{ font: '12px system-ui', color: '#9ca3af', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {r.stage !== 'decided' && r.waitingDays != null && <span>waiting {waited(r.waitingDays)}</span>}
          {r.totals.required > 0 && <span>{r.totals.approved}/{r.totals.required} approved</span>}
          {r.reviewSentAt && <span>sent to reviewers {fmtDate(r.reviewSentAt)}</span>}
          {r.driveFolderUrl && role === 'staff' && <a href={r.driveFolderUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>📁 Drive</a>}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
        <span style={{ font: '700 11px system-ui', color: st.c, background: st.b, borderRadius: 7, padding: '3px 9px', whiteSpace: 'nowrap' }}>
          {st.dot} {labels[r.stage]}
        </span>
        {/* The window, in the words of the rule: days left, not a raw date. */}
        {r.daysLeft != null && r.stage !== 'decided' && (
          <span style={{ font: `${r.daysLeft < 0 ? 700 : 600} 11.5px system-ui`, color: r.daysLeft < 0 ? '#991b1b' : r.daysLeft <= 7 ? '#92400e' : '#6b7280', whiteSpace: 'nowrap' }}>
            {r.daysLeft < 0 ? `${Math.abs(r.daysLeft)} days past the window` : `${r.daysLeft} days left · due ${fmtDate(r.dueAt)}`}
          </span>
        )}
        {r.alarm === 'stalled' && r.daysLeft == null && (
          <span style={{ font: '600 11.5px system-ui', color: '#3730a3', whiteSpace: 'nowrap' }}>💤 no movement</span>
        )}
        {r.stage === 'signature' && role !== 'staff' && (
          <span style={{ font: '11.5px system-ui', color: '#9ca3af', whiteSpace: 'nowrap' }}>signing link is in your email</span>
        )}
        {href
          ? <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} style={{ font: '600 12.5px system-ui', color: '#fff', background: st.c, borderRadius: 8, padding: '6px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              {role === 'staff' ? 'Open →' : 'Review documents →'}
            </a>
          : onOpen
            ? <button onClick={() => onOpen(r.id)} style={{ font: '600 12.5px system-ui', color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Details</button>
            : null}
      </div>
    </div>
  )
}
