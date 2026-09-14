'use client'

// The "Processing audit" card — six facts about how an application has
// been handled, shown on the staff application page and on the public
// share link (/application-audit/[token]). Same component in both places
// so the realtor sees exactly what staff see. Data: lib/application-audit.ts.

import type { ProcessingAudit } from '@/lib/application-audit'

const ET: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
const ETD: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', month: 'short', day: 'numeric' }
export const fmtET = (iso: string | null | undefined) => iso ? `${new Date(iso).toLocaleString('en-US', ET)} ET` : '—'
const fmtD = (iso: string) => new Date(iso).toLocaleDateString('en-US', ETD)
export function fmtHours(h: number | null | undefined): string {
  if (h == null) return '—'
  if (h < 1 / 60) return 'under a minute'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${Math.round(h * 10) / 10} h`
  return `${Math.round(h / 24 * 10) / 10} days`
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

type A = Omit<ProcessingAudit, 'files'> & { files?: ProcessingAudit['files'] }

export default function ProcessingAuditCard({ a, showFiles = false }: { a: A; showFiles?: boolean }) {
  const collecting = a.board.sentAt ? Math.max(0, Math.round((new Date(a.board.sentAt).getTime() - new Date(a.createdAt).getTime()) / 86_400_000)) : a.daysInProcess
  const boardDays = a.board.daysWithBoard ?? 0
  const total = Math.max(1, collecting + boardDays)
  const pill = (text: string, tone: 'good' | 'wait' | 'board' | 'bad') => {
    const c = tone === 'good' ? ['#166534', '#f0fdf4', '#bbf7d0'] : tone === 'wait' ? ['#92400e', '#fffbeb', '#fde68a'] : tone === 'board' ? ['#1e40af', '#eff6ff', '#bfdbfe'] : ['#b42318', '#fdf2f0', '#f3c9c3']
    return <span style={{ display: 'inline-block', font: '600 11px system-ui', color: c[0], background: c[1], border: `1px solid ${c[2]}`, borderRadius: 999, padding: '2px 8px', marginLeft: 6, verticalAlign: 1 }}>{text}</span>
  }
  const row = (n: number, label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 230px) 1fr', gap: 12, padding: '10px 14px', borderTop: n === 1 ? 0 : '1px solid #e5e7eb', alignItems: 'baseline' }}>
      <div style={{ font: '600 12.5px system-ui', color: '#6b7280' }}><span style={{ display: 'inline-block', width: 18, color: '#9ca3af', fontWeight: 700 }}>{n}</span>{label}</div>
      <div>
        <div style={{ font: '600 14px system-ui', color: '#1c2333', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {sub && <div style={{ font: '12px system-ui', color: '#6b7280', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  )
  const req = a.requests
  const reqParts = [
    req.staffRequests ? `${plural(req.staffRequests, 'document request')} from PMI` : null,
    req.staffRepliesAskingUpload ? `${plural(req.staffRepliesAskingUpload, 'reply')} asking to upload` : null,
    `${plural(req.autoReminders, 'automatic reminder')} from MAIA`,
  ].filter(Boolean).join(' · ')
  const reqDates = req.dates.length ? ` (${req.dates.map(fmtD).join(', ')})` : ''
  const ap = a.approval
  const boardStatus = a.closed
    ? pill(a.closed.status === 'approved' ? `Approved${a.closed.at ? ` ${fmtD(a.closed.at)}` : ''}` : a.closed.status.charAt(0).toUpperCase() + a.closed.status.slice(1), a.closed.status === 'approved' ? 'good' : 'bad')
    : a.board.sentAt ? pill(`${plural(boardDays, 'day')} with the board`, 'board') : pill('Not sent yet', 'wait')

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
        <div style={{ font: '700 13px system-ui', color: '#1f2a44' }}>Processing audit</div>
        <div style={{ font: '600 12px system-ui', color: '#c0571a', background: '#fff4ec', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
          {plural(a.daysInProcess, 'day')} in process{a.closed ? ` · closed ${a.closed.at ? fmtD(a.closed.at) : ''}` : ` · today ${fmtD(a.generatedAt)}`}
        </div>
      </div>
      {row(1, 'Initial contact · application created', fmtET(a.createdAt),
        a.firstFileAt ? `First document arrived ${fmtET(a.firstFileAt)}.` : 'No document has arrived yet.')}
      {row(2, 'Last file received', fmtET(a.lastFileAt),
        a.lastFileAt ? <>{a.lastFileLabel}.{a.lastApplicantFileAt && a.lastApplicantFileAt !== a.lastFileAt ? ` Last sent by the applicant: ${a.lastApplicantFileLabel}, ${fmtET(a.lastApplicantFileAt)}.` : ''}</> : null)}
      {row(3, 'Emails asking for documents', String(req.total), `${reqParts}${reqDates}.`)}
      {row(4, 'Time for PMI to approve a file received',
        ap.decided ? <>{fmtHours(ap.medianHours)} typical <span style={{ fontWeight: 400, color: '#6b7280' }}>(median)</span> · {fmtHours(ap.averageHours)} average</> : 'No file decided yet',
        ap.decided ? <>{ap.decided} of {plural(ap.files, 'file')} decided · {ap.withinHour} approved within the hour.{ap.slowest && ap.slowest.hours > 24 ? ` Slowest: ${ap.slowest.label} (${fmtHours(ap.slowest.hours)}), which pulls the average up.` : ''}</> : null)}
      {row(5, 'Files or information still missing',
        <>{a.missing.count}{a.missing.complete ? pill(`Complete${a.missing.completeSince ? ` since ${fmtD(a.missing.completeSince)}` : ''}`, 'good') : a.missing.count ? pill('Waiting on the applicant side', 'wait') : null}</>,
        a.missing.count ? a.missing.items.join(' · ') : 'Every required document is on file and approved. Not waiting on the applicant for anything.')}
      {row(6, 'Sent to the board for final review',
        <>{fmtET(a.board.sentAt)}{boardStatus}</>,
        a.board.sentAt ? <>
          {a.board.interviewRequestedAt ? `Interview requested ${fmtD(a.board.interviewRequestedAt)}` : ''}{a.board.interviewCompletedAt ? ` · interview held ${fmtD(a.board.interviewCompletedAt)}` : a.board.interviewRequestedAt ? ' · interview not held yet' : ''}
          {a.board.letterSigners != null ? <>{a.board.interviewRequestedAt ? ' · ' : ''}approval letter signatures: <b>{a.board.letterSigned} of {a.board.letterSigners} signed</b>{a.board.letterSentAt ? ` · letter emailed ${fmtD(a.board.letterSentAt)}` : a.board.letterSigned !== a.board.letterSigners ? pill('Waiting on the board', 'wait') : null}</> : null}
        </> : 'Goes to the board once every required document is approved.')}
      {a.screening && (() => {
        const done = a.screening.steps.find(s => /complete/i.test(s.label) && /service/i.test(s.label)) ?? a.screening.steps[a.screening.steps.length - 1]
        const beforeMaia = done && done.at < a.createdAt
        return (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 230px) 1fr', gap: 12, alignItems: 'baseline' }}>
              <div style={{ font: '600 12.5px system-ui', color: '#6b7280' }}><span style={{ display: 'inline-block', width: 18, color: '#9ca3af', fontWeight: 700 }}>7</span>Background check · {a.screening.provider}</div>
              <div>
                <div style={{ font: '600 14px system-ui', color: '#1c2333', fontVariantNumeric: 'tabular-nums' }}>Completed {fmtET(done?.at)}{pill('Done', 'good')}</div>
                {beforeMaia && <div style={{ font: '12px system-ui', color: '#6b7280', marginTop: 2 }}>Run before this application was opened in MAIA ({fmtD(a.createdAt)}); the report was filed on the applicant card.</div>}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {a.screening.steps.map((s, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10, alignItems: 'start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ width: 16, height: 16, borderRadius: 8, background: '#dcfce7', color: '#15803d', font: '700 10px system-ui', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                        {i < a.screening!.steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 14, background: '#e5e7eb', margin: '2px 0' }} />}
                      </div>
                      <div style={{ paddingBottom: 6 }}>
                        <div style={{ font: '600 12.5px system-ui', color: '#1c2333' }}>{s.label}</div>
                        <div style={{ font: '11.5px system-ui', color: '#6b7280' }}>{fmtET(s.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <div style={{ font: '600 12px system-ui', color: '#1c2333', marginBottom: 2 }}>Where the {plural(a.daysInProcess, 'day')} went</div>
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', margin: '6px 0' }} aria-label={`Collecting documents ${collecting} days, board ${boardDays} days`}>
          <span style={{ width: `${(collecting / total) * 100}%`, background: '#f3b589' }} />
          <span style={{ width: `${(boardDays / total) * 100}%`, background: '#8fb5e0' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, font: '12px system-ui', color: '#6b7280' }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 5, background: '#f3b589', verticalAlign: -1 }} />Collecting documents (applicant + PMI) · {plural(collecting, 'day')}</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 5, background: '#8fb5e0', verticalAlign: -1 }} />Board interview and signatures · {plural(boardDays, 'day')}</span>
        </div>
      </div>
      {showFiles && a.files && a.files.length > 0 && (
        <details style={{ borderTop: '1px solid #e5e7eb' }}>
          <summary style={{ padding: '8px 14px', font: '600 12px system-ui', color: '#2563eb', cursor: 'pointer' }}>Per-file detail ({a.files.length})</summary>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', font: '12px system-ui' }}>
              <thead><tr style={{ color: '#6b7280', textAlign: 'left' }}><th style={{ padding: '4px 14px' }}>File</th><th style={{ padding: '4px 8px' }}>From</th><th style={{ padding: '4px 8px' }}>Received</th><th style={{ padding: '4px 8px' }}>Decided</th><th style={{ padding: '4px 8px' }}>Took</th></tr></thead>
              <tbody>{a.files.map((f, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '4px 14px', color: '#1c2333' }}>{f.label}</td><td style={{ padding: '4px 8px', color: '#6b7280' }}>{f.bySource}</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{fmtET(f.receivedAt)}</td><td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{f.decidedAt ? `${fmtET(f.decidedAt)} · ${f.decision}` : 'pending'}</td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: (f.hours ?? 0) > 24 ? '#b42318' : '#166534' }}>{fmtHours(f.hours)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
