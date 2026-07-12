// =====================================================================
// app/board/review/page.tsx
// Public board member review page — token-protected
// =====================================================================

'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import { DocumentPreviewTrigger } from '@/components/DocumentPreviewTrigger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Applicant {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dob?: string;
  [key: string]: unknown;
}

interface ApplicationData {
  id: string;
  association: string | null;
  app_type: string | null;
  applicants: Applicant[] | null;
  entity_name: string | null;
  stripe_payment_status: string | null;
  unit?: string | null;
  occupants?: { name?: string; relationship?: string; dob?: string; age?: string }[] | null;
  principals?: { name?: string; dob?: string }[] | null;
  is_married_couple?: boolean | null;
  total_charged?: number | null;
  screening_status?: string | null;
  screening_report_url?: string | null;
  rules_signature?: string | null;
  rules_agreed_at?: string | null;
  [key: string]: unknown;
}

interface BoardMember {
  name: string;
  email: string;
}

interface Documents { govId: string | null; proofIncome: string | null; marriageCert: string | null; lease: string | null }
interface AckDoc { id: string; filename: string | null; category: string | null; effective_date: string | null }
interface Stakeholder { role: string; name: string | null; email: string | null; phone: string | null }
interface ScreeningSubjectSummary { name: string | null; status: string | null; report_url: string | null }

type LoadState = 'loading' | 'invalid' | 'decided' | 'ready';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApplicantName(app: ApplicationData): string {
  if (app.app_type === 'commercial' && app.entity_name) return app.entity_name;
  const first = app.applicants?.[0];
  if (!first) return 'Applicant';
  return [first.firstName, first.lastName].filter(Boolean).join(' ') || 'Applicant';
}

function getUnit(app: ApplicationData): string {
  // unit may be stored in multiple ways
  if (app.unit) return String(app.unit);
  if (app.applicants?.[0]) {
    const a = app.applicants[0] as Record<string, unknown>;
    if (a.unit) return String(a.unit);
    if (a.unitApplying) return String(a.unitApplying);
  }
  return '—';
}

function substituteVars(
  template: string,
  applicantName: string,
  unit: string,
  association: string,
  date: string,
  boardMemberName: string
): string {
  return template
    .replace(/\{\{applicant_name\}\}/g, applicantName)
    .replace(/\{\{unit\}\}/g, unit)
    .replace(/\{\{association\}\}/g, association)
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{board_member_name\}\}/g, boardMemberName);
}

function refId(id: string): string {
  return `PMI-${id.slice(0, 8).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function BoardReviewPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [application, setApplication] = useState<ApplicationData | null>(null);
  const [boardMember, setBoardMember] = useState<BoardMember | null>(null);
  const [letterTemplate, setLetterTemplate] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Documents | null>(null);
  const [ackDocs, setAckDocs] = useState<AckDoc[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [subjects, setSubjects] = useState<ScreeningSubjectSummary[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);

  const [decision, setDecision] = useState<'approved' | 'rejected' | 'more_info' | null>(null);
  const [signature, setSignature] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Parse token (or a staff preview id) from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    const previewId = params.get('preview');
    setToken(t);

    if (!t && !previewId) {
      setLoadState('invalid');
      return;
    }

    const qs = previewId ? `preview=${encodeURIComponent(previewId)}` : `token=${encodeURIComponent(t!)}`;
    fetch(`/api/board/review?${qs}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) {
          setLoadState('invalid');
          return;
        }
        if (json.alreadyDecided) {
          setLoadState('decided');
          return;
        }
        setApplication(json.application);
        setBoardMember(json.boardMember);
        setLetterTemplate(json.letterTemplate);
        setDocuments(json.documents ?? null);
        setAckDocs(json.acknowledgedDocs ?? []);
        setStakeholders(json.stakeholders ?? []);
        setSubjects(json.subjects ?? []);
        setIsPreview(!!json.preview);
        setLoadState('ready');
      })
      .catch(() => setLoadState('invalid'));
  }, []);

  async function handleSubmit() {
    if (!decision || !token) return;
    if (decision === 'more_info' ? !notes.trim() : !signature.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/board/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision, signature: signature.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Submission failed');
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  // Derived letter text
  const applicantName = application ? getApplicantName(application) : '';
  const unit = application ? getUnit(application) : '';
  const association = application?.association ?? 'the Association';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const memberName = boardMember?.name ?? '';

  const defaultLetter = `I, the undersigned board member of ${association}, hereby confirm that the application of ${applicantName} for Unit ${unit} has been reviewed and approved in accordance with the Association's governing documents.`;

  const letterText = letterTemplate
    ? substituteVars(letterTemplate, applicantName, unit, association, today, memberName)
    : substituteVars(defaultLetter, applicantName, unit, association, today, memberName);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0d0d0d',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    color: '#0d0d0d',
    borderRadius: 12,
    padding: '2rem',
    maxWidth: 680,
    margin: '2rem auto',
    boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
  };

  if (loadState === 'loading') {
    return (
      <div style={containerStyle}>
        <SiteHeader subtitle="BOARD REVIEW" />
        <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ color: '#6b7280', fontSize: '0.95rem' }}>Loading review…</div>
        </div>
      </div>
    );
  }

  if (loadState === 'invalid') {
    return (
      <div style={containerStyle}>
        <SiteHeader subtitle="BOARD REVIEW" />
        <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
          <h2 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Invalid or Expired Link</h2>
          <p style={{ color: '#6b7280', margin: 0 }}>
            This link is invalid or has expired. Please contact{' '}
            <a href="mailto:support@topfloridaproperties.com" style={{ color: '#f26a1b' }}>
              support@topfloridaproperties.com
            </a>{' '}
            if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  if (loadState === 'decided') {
    return (
      <div style={containerStyle}>
        <SiteHeader subtitle="BOARD REVIEW" />
        <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>Decision Already Submitted</h2>
          <p style={{ color: '#6b7280', margin: 0 }}>
            You have already submitted your decision. Thank you for your participation.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={containerStyle}>
        <SiteHeader subtitle="BOARD REVIEW" />
        <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>
            {decision === 'approved' ? '✅' : decision === 'more_info' ? '💬' : '✗'}
          </div>
          <h2 style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>
            {decision === 'approved' ? 'Application Approved' : decision === 'more_info' ? 'Request Sent to Staff' : 'Application Rejected'}
          </h2>
          <p style={{ color: '#6b7280', margin: 0 }}>
            {decision === 'more_info'
              ? `Staff has been notified. You can come back to this same link once you have what you need to submit a final decision, ${memberName}.`
              : `Your decision has been recorded. Thank you, ${memberName}.`}
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main review form
  // ---------------------------------------------------------------------------

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#6b7280',
    marginBottom: '0.35rem',
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#0d0d0d',
    borderBottom: '2px solid #f26a1b',
    paddingBottom: '0.4rem',
    marginBottom: '1rem',
  };

  return (
    <div style={containerStyle}>
      <SiteHeader subtitle="BOARD REVIEW" />

      <div style={{ padding: '0 1rem 4rem' }}>
        <div style={cardStyle}>

          {isPreview && (
            <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, color: '#1e40af', fontSize: '0.85rem', fontWeight: 600 }}>
              👁 Staff preview — this is exactly what a board member sees. Decisions can&rsquo;t be submitted from here.
            </div>
          )}

          {/* Header */}
          <div style={{ marginBottom: '1.75rem' }}>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 700, margin: '0 0 0.25rem', color: '#0d0d0d' }}>
              Board Review Request
            </h1>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '0.9rem' }}>
              {isPreview ? 'This is what the board member sees when they open their review link.' : (
                <>Dear <strong>{memberName}</strong>, please review the application below and sign your decision.</>
              )}
            </p>
          </div>

          {/* Application summary */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={sectionTitle}>Application Summary</div>
            <div style={{
              background: '#f9fafb',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <tbody>
                  {[
                    ['Reference', application ? refId(application.id) : '—'],
                    ['Applicant', applicantName],
                    ['Association', association],
                    ['Unit', unit],
                    ['Application Type', application?.app_type ?? '—'],
                    ['Payment', (() => {
                      const s = application?.stripe_payment_status;
                      return s === 'paid' || s === 'succeeded' ? 'Confirmed' : (s ?? 'Pending');
                    })()],
                  ].map(([label, value], i) => (
                    <tr key={label} style={{ borderBottom: i < 5 ? '1px solid #e5e7eb' : 'none' }}>
                      <td style={{ padding: '0.6rem 1rem', fontWeight: 600, color: '#374151', width: '40%', background: i % 2 === 0 ? '#f3f4f6' : '#f9fafb' }}>
                        {label}
                      </td>
                      <td style={{ padding: '0.6rem 1rem', color: '#0d0d0d', background: '#fff' }}>
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Full review package ───────────────────────────────────── */}
          {application && (
            <>
              {/* Applicants / principals + occupants -- each with their own
                  Gov ID, Proof of Income, and Checkr background check,
                  since every applicant/principal has a separate order. */}
              <div style={{ marginBottom: '1.75rem' }}>
                <div style={sectionTitle}>{application.app_type === 'commercial' ? 'Entity & Principals' : 'Applicants'}</div>
                {application.app_type === 'commercial' && application.entity_name && (
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>{application.entity_name}</div>
                )}
                {(application.app_type === 'commercial' ? (application.principals ?? []) : (application.applicants ?? [])).map((p, i) => {
                  const a = p as Record<string, unknown>;
                  const name = application.app_type === 'commercial'
                    ? String(a.name ?? `Principal ${i + 1}`)
                    : [a.firstName, a.lastName].filter(Boolean).join(' ') || `Applicant ${i + 1}`;
                  const meta = [a.email, a.phone, a.dob && `DOB ${a.dob}`, a.unitApplying && `Unit ${a.unitApplying}`].filter(Boolean).join('  ·  ');
                  const govId = a.govIdUrl as string | undefined;
                  const proofIncome = a.proofIncomeUrl as string | undefined;
                  const subject = subjects[i];
                  return (
                    <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.65rem 0.9rem', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{name}</div>
                      {meta && <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.15rem' }}>{meta}</div>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                        {govId
                          ? <DocumentPreviewTrigger label="Government ID ↗" previewUrl={`/api/document-preview?url=${encodeURIComponent(govId)}`} downloadUrl={govId} style={{ color: '#f26a1b', fontWeight: 700 }} />
                          : <span style={{ color: '#9ca3af' }}>Government ID — not provided</span>}
                        {proofIncome
                          ? <DocumentPreviewTrigger label="Proof of Income ↗" previewUrl={`/api/document-preview?url=${encodeURIComponent(proofIncome)}`} downloadUrl={proofIncome} style={{ color: '#f26a1b', fontWeight: 700 }} />
                          : <span style={{ color: '#9ca3af' }}>Proof of Income — not provided</span>}
                      </div>
                      <div style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}>
                        {subject?.report_url
                          ? <DocumentPreviewTrigger label="View background check report ↗" previewUrl={`/api/document-preview?url=${encodeURIComponent(subject.report_url)}`} downloadUrl={subject.report_url} style={{ color: '#f26a1b', fontWeight: 700 }} />
                          : <span style={{ color: '#92400e' }}>Background check — {subject?.status ?? 'pending'}</span>}
                      </div>
                    </div>
                  );
                })}
                {application.is_married_couple && <div style={{ fontSize: '0.8rem', color: '#16a34a', marginTop: '0.3rem' }}>✓ Married couple</div>}
                {(application.occupants ?? []).length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#374151' }}>
                    <strong>Other occupants:</strong> {(application.occupants ?? []).map(o => `${o.name ?? '—'}${o.age ? ` (${o.age})` : ''}`).join(', ')}
                  </div>
                )}
              </div>

              {/* Documents shared across the whole application (not tied to
                  one applicant) -- lease/purchase agreement and, for a
                  couple, the marriage certificate. */}
              <div style={{ marginBottom: '1.75rem' }}>
                <div style={sectionTitle}>Documents</div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {([['Lease / purchase agreement', 'lease'], ['Marriage certificate', 'marriageCert']] as const).map(([label, key]) => {
                    const url = documents ? documents[key] : null;
                    return (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.55rem 0.9rem', fontSize: '0.85rem' }}>
                        <span>📄 {label}</span>
                        {url ? <DocumentPreviewTrigger label="Open ↗" previewUrl={`/api/document-preview?url=${encodeURIComponent(url)}`} downloadUrl={url} style={{ color: '#f26a1b', fontWeight: 700 }} /> : <span style={{ color: '#9ca3af' }}>Not provided</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Background / credit / eviction -- fallback for legacy rows
                  with no per-applicant subjects at all. */}
              {subjects.length === 0 && (
              <div style={{ marginBottom: '1.75rem' }}>
                <div style={sectionTitle}>Background, Credit & Eviction</div>
                {application.screening_report_url ? (
                  <DocumentPreviewTrigger label="View screening report ↗" previewUrl={`/api/document-preview?url=${encodeURIComponent(application.screening_report_url)}`} downloadUrl={application.screening_report_url} style={{ display: 'inline-block', color: '#f26a1b', fontWeight: 700, fontSize: '0.9rem' }} />
                ) : (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.7rem 1rem', fontSize: '0.83rem', color: '#92400e' }}>
                    Screening {application.screening_status ? `— ${application.screening_status}` : 'pending'}. The full report appears here once it completes.
                  </div>
                )}
              </div>
              )}

              {/* Rules acknowledgment */}
              <div style={{ marginBottom: '1.75rem' }}>
                <div style={sectionTitle}>Rules Acknowledgment</div>
                <div style={{ fontSize: '0.85rem', color: '#374151' }}>
                  {application.rules_signature
                    ? <>Signed by <strong>{application.rules_signature}</strong>{application.rules_agreed_at ? ` on ${new Date(application.rules_agreed_at).toLocaleDateString('en-US')}` : ''}.</>
                    : <span style={{ color: '#9ca3af' }}>Not signed.</span>}
                </div>
                {ackDocs.length > 0 && (
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.78rem', color: '#6b7280' }}>
                    {ackDocs.map(d => <li key={d.id}>{d.filename ?? d.category}{d.effective_date ? `  ·  ${d.effective_date}` : ''}</li>)}
                  </ul>
                )}
                {application.rules_signature && (
                  <DocumentPreviewTrigger
                    label="View signed acknowledgment ↗"
                    previewUrl={`/api/applications/${application.id}/rules-acknowledgment-pdf?preview=1${isPreview ? '' : `&token=${token}`}`}
                    downloadUrl={`/api/applications/${application.id}/rules-acknowledgment-pdf${isPreview ? '' : `?token=${token}`}`}
                    style={{ display: 'inline-block', marginTop: '0.6rem', fontSize: '0.8rem', fontWeight: 600, color: '#f26a1b', textDecoration: 'none' }}
                  />
                )}
              </div>

              {/* People involved (collaborative stakeholders) */}
              {stakeholders.length > 0 && (
                <div style={{ marginBottom: '1.75rem' }}>
                  <div style={sectionTitle}>People Involved</div>
                  <div style={{ display: 'grid', gap: '0.35rem' }}>
                    {stakeholders.map((s, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.85rem', borderBottom: '1px solid #f3f4f6', padding: '0.3rem 0' }}>
                        <span style={{ color: '#6b7280', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{s.role.replace(/_/g, ' ')}</span>
                        <span style={{ fontWeight: 600, textAlign: 'right' }}>{s.name ?? '—'}{s.email ? `  ·  ${s.email}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Approval letter */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={sectionTitle}>Approval Letter</div>
            <div style={{
              background: '#fffbf5',
              border: '1px solid #fed7aa',
              borderRadius: 8,
              padding: '1.25rem',
              fontSize: '0.95rem',
              lineHeight: 1.7,
              color: '#0d0d0d',
              whiteSpace: 'pre-wrap',
              fontFamily: 'Georgia, serif',
            }}>
              {letterText}
            </div>
          </div>

          {isPreview ? (
            <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, color: '#6b7280', fontSize: '0.85rem', textAlign: 'center' }}>
              Approve / Reject / Request More Info controls appear here for the actual board member.
            </div>
          ) : (
          <>
          {/* Decision */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={sectionTitle}>Your Decision</div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setDecision('approved')}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: 8,
                  border: `2px solid ${decision === 'approved' ? '#16a34a' : '#d1d5db'}`,
                  background: decision === 'approved' ? '#16a34a' : '#fff',
                  color: decision === 'approved' ? '#fff' : '#374151',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                ✓ Approve
              </button>
              <button
                onClick={() => setDecision('rejected')}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: 8,
                  border: `2px solid ${decision === 'rejected' ? '#dc2626' : '#d1d5db'}`,
                  background: decision === 'rejected' ? '#dc2626' : '#fff',
                  color: decision === 'rejected' ? '#fff' : '#374151',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                ✗ Reject
              </button>
              <button
                onClick={() => setDecision('more_info')}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: 8,
                  border: `2px solid ${decision === 'more_info' ? '#f26a1b' : '#d1d5db'}`,
                  background: decision === 'more_info' ? '#f26a1b' : '#fff',
                  color: decision === 'more_info' ? '#fff' : '#374151',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                ? Request More Info
              </button>
            </div>
          </div>

          {/* Signature -- not needed for a mere info request */}
          {decision !== 'more_info' && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Electronic Signature</label>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#6b7280' }}>
                Type your full legal name to sign this decision
              </p>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={memberName || 'Your full legal name'}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  border: `1px solid ${signature.trim() ? '#f26a1b' : '#d1d5db'}`,
                  borderRadius: 8,
                  fontSize: '1.15rem',
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontStyle: 'italic',
                  color: '#0d0d0d',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
              />
            </div>
          )}

          {/* Notes -- required for a "request more info", optional otherwise */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>{decision === 'more_info' ? 'What additional information do you need?' : 'Notes (optional)'}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={decision === 'more_info' ? 'e.g. missing proof of income, unclear on the co-applicant’s relationship to the unit…' : 'Any comments or conditions for this decision…'}
              rows={3}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                border: `1px solid ${decision === 'more_info' && !notes.trim() ? '#fca5a5' : '#d1d5db'}`,
                borderRadius: 8,
                fontSize: '0.875rem',
                color: '#0d0d0d',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Submit */}
          {submitError && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b', fontSize: '0.875rem' }}>
              {submitError}
            </div>
          )}
          {(() => {
            const ready = !!decision && (decision === 'more_info' ? !!notes.trim() : !!signature.trim());
            const disabled = !ready || submitting;
            return (
              <button
                onClick={handleSubmit}
                disabled={disabled}
                style={{
                  width: '100%',
                  padding: '0.9rem',
                  background: disabled ? '#d1d5db' : '#f26a1b',
                  color: disabled ? '#9ca3af' : '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                {submitting ? 'Submitting…' : decision === 'more_info' ? 'Send Request' : 'Submit Decision'}
              </button>
            );
          })()}

          <p style={{ margin: '1rem 0 0', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
            This is a secure, unique link. By submitting you confirm your identity as a board member of {association}.
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
