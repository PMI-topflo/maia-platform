// =====================================================================
// app/admin/applications/ApplicationsTable.tsx
// Client Component — filterable list with inline detail panel and
// board-decision workflow.
// =====================================================================

'use client';

import { useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Applicant = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dob?: string;
  address?: string;
  ssn?: string;
  [key: string]: unknown;
};

type Occupant = {
  name?: string;
  relationship?: string;
  dob?: string;
  [key: string]: unknown;
};

export type Application = {
  id: string;
  association: string | null;
  app_type: string | null;
  stripe_payment_status: string | null;
  total_charged: number | null;
  created_at: string;
  applicants: Applicant[] | null;
  entity_name: string | null;
  language: string | null;
  docs_lease_url: string | null;
  docs_gov_id_url: string | null;
  docs_proof_income_url: string | null;
  docs_marriage_cert_url: string | null;
  is_married_couple: boolean | null;
  occupants: Occupant[] | null;
  rules_signature: string | null;
  rules_agreed_at: string | null;
  acknowledged_document_ids: string[] | null;
  rules_signature_image:    string | null;
  rules_applicant_photo:    string | null;
  rules_signed_ip:          string | null;
  rules_signed_user_agent:  string | null;
  rules_signed_geolocation: { lat: number; lon: number; accuracy_meters: number; timestamp_ms: number } | null;
  board_decision: 'approved' | 'rejected' | 'pending' | 'board_review' | null;
  board_decided_at: string | null;
  board_notes: string | null;
};

interface Props {
  applications: Application[];
  /** Pre-resolved metadata for every acknowledged_document_ids UUID
   *  across all applications. Built server-side in page.tsx so the
   *  client doesn't have to fetch per-row. Missing IDs (e.g., doc was
   *  deleted after the applicant signed) render as "[deleted document]"
   *  rather than crashing. */
  documentLookup: Record<string, { filename: string; category: string; effective_date: string | null }>;
}

const DOC_CATEGORY_LABELS: Record<string, string> = {
  condo_docs: 'Condo Docs / Declaration',
  rules_regs: 'Rules & Regulations',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'pending' | 'board_review' | 'approved' | 'rejected';

function getApplicantName(app: Application): string {
  if (app.app_type === 'commercial' && app.entity_name) return app.entity_name;
  const first = app.applicants?.[0];
  if (!first) return '—';
  return [first.firstName, first.lastName].filter(Boolean).join(' ') || '—';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function refId(id: string): string {
  return `PMI-${id.slice(0, 8).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

function AppTypeBadge({ type }: { type: string | null }) {
  const map: Record<string, string> = {
    individual: 'bg-blue-100 text-blue-800',
    couple: 'bg-purple-100 text-purple-800',
    commercial: 'bg-yellow-100 text-yellow-800',
    additionalResident: 'bg-gray-100 text-gray-800',
  };
  const label = type ?? 'unknown';
  const cls = map[label] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function PaymentBadge({ status }: { status: string | null }) {
  const paid = status === 'paid' || status === 'succeeded';
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
        paid ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
      }`}
    >
      {paid ? 'Paid' : status ?? 'Pending'}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string | null }) {
  if (decision === 'approved')
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
        Approved
      </span>
    );
  if (decision === 'rejected')
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
        Rejected
      </span>
    );
  if (decision === 'board_review')
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
        Board Review
      </span>
    );
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
      Pending
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({
  app,
  documentLookup,
  onDecisionSaved,
}: {
  app: Application;
  documentLookup: Record<string, { filename: string; category: string; effective_date: string | null }>;
  onDecisionSaved: (updated: Partial<Application>) => void;
}) {
  const [decision, setDecision] = useState<'approved' | 'rejected' | 'pending'>(
    (app.board_decision === 'board_review' ? 'pending' : app.board_decision) ?? 'pending'
  );
  const [notes, setNotes] = useState(app.board_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [sendingToBoard, setSendingToBoard] = useState(false);
  const [sendToBoardResult, setSendToBoardResult] = useState<string | null>(null);
  const [sendToBoardError, setSendToBoardError] = useState<string | null>(null);

  async function handleSendToBoard() {
    setSendingToBoard(true);
    setSendToBoardResult(null);
    setSendToBoardError(null);
    try {
      const res = await fetch(`/api/admin/applications/${app.id}/send-to-board`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Failed to send to board');
      setSendToBoardResult(`Sent to ${json.sent} board member${json.sent === 1 ? '' : 's'}`);
      onDecisionSaved({ board_decision: 'board_review', board_decided_at: new Date().toISOString() });
    } catch (err) {
      setSendToBoardError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSendingToBoard(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/applications/${app.id}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Save failed');
      setSaved(true);
      onDecisionSaved({ board_decision: decision, board_notes: notes, board_decided_at: new Date().toISOString() });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  const docLinks: { label: string; url: string | null }[] = [
    { label: 'Government ID', url: app.docs_gov_id_url },
    { label: 'Proof of Income', url: app.docs_proof_income_url },
    { label: 'Marriage Certificate', url: app.docs_marriage_cert_url },
    { label: 'Lease Agreement', url: app.docs_lease_url },
  ];

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-6 py-5 space-y-6">
      {/* Applicants */}
      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
          Applicant(s)
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {(app.applicants ?? []).map((a, i) => (
            <div key={i} className="bg-white rounded border border-gray-200 p-4 text-sm space-y-1">
              <div className="font-medium text-[#0d0d0d]">
                {[a.firstName, a.lastName].filter(Boolean).join(' ') || `Applicant ${i + 1}`}
              </div>
              {a.email && <div className="text-gray-600">Email: {a.email}</div>}
              {a.phone && <div className="text-gray-600">Phone: {a.phone}</div>}
              {a.dob && <div className="text-gray-600">DOB: {a.dob}</div>}
              {a.address && <div className="text-gray-600">Address: {a.address}</div>}
              {a.ssn != null && (
                <div className="text-gray-600">SSN: *****</div>
              )}
            </div>
          ))}
          {app.entity_name && (
            <div className="bg-white rounded border border-gray-200 p-4 text-sm">
              <div className="font-medium text-[#0d0d0d]">Entity</div>
              <div className="text-gray-600">{app.entity_name}</div>
            </div>
          )}
        </div>
      </section>

      {/* Occupants */}
      {app.occupants && app.occupants.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
            Occupants
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {app.occupants.map((o, i) => (
              <div key={i} className="bg-white rounded border border-gray-200 p-3 text-sm space-y-0.5">
                <div className="font-medium">{o.name ?? `Occupant ${i + 1}`}</div>
                {o.relationship && <div className="text-gray-500">Relationship: {o.relationship}</div>}
                {o.dob && <div className="text-gray-500">DOB: {o.dob}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Application details */}
      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
          Application Details
        </h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-gray-500">Married Couple</dt>
            <dd className="font-medium">{app.is_married_couple ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Language</dt>
            <dd className="font-medium">{app.language ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Rules Signature</dt>
            <dd className="font-medium">{app.rules_signature ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Rules Agreed At</dt>
            <dd className="font-medium">{fmtDate(app.rules_agreed_at)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Total Charged</dt>
            <dd className="font-medium">{fmtMoney(app.total_charged)}</dd>
          </div>
          {/* Acknowledged governing documents — audit trail of which
              Condo Docs + Rules PDF versions the applicant opened
              before signing. Cross-references against documentLookup
              built server-side. Older deleted documents show their UUID
              so the audit trail is still readable. */}
          {app.acknowledged_document_ids && app.acknowledged_document_ids.length > 0 && (
            <div className="col-span-2">
              <dt className="text-gray-500">Documents Acknowledged at Signature</dt>
              <dd className="font-medium">
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {app.acknowledged_document_ids.map(id => {
                    const meta = documentLookup[id];
                    if (!meta) {
                      return (
                        <li key={id} className="text-xs text-gray-500">
                          <code className="font-mono">{id.slice(0, 8)}</code> — <span className="italic">document no longer in library</span>
                        </li>
                      );
                    }
                    const label = DOC_CATEGORY_LABELS[meta.category] ?? meta.category;
                    return (
                      <li key={id} className="text-sm">
                        <span className="font-semibold">{label}</span>
                        <span className="text-gray-500"> — {meta.filename}</span>
                        {meta.effective_date && (
                          <span className="text-gray-400 text-xs ml-1">(effective {meta.effective_date})</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* Signature evidence — drawn signature, photo, IP, geo */}
      {(app.rules_signature_image || app.rules_applicant_photo || app.rules_signed_ip || app.rules_signed_geolocation) && (
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
            Signature Evidence
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {app.rules_signature_image && (
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wide font-mono mb-1">Drawn Signature</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={app.rules_signature_image} alt="Drawn signature" className="border border-gray-300 rounded bg-white max-w-[320px]" />
              </div>
            )}
            {app.rules_applicant_photo && (
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wide font-mono mb-1">Applicant Photo</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={app.rules_applicant_photo} alt="Applicant at signature time" className="border border-gray-300 rounded max-w-[240px]" />
              </div>
            )}
            <div className="md:col-span-2 space-y-1 text-xs font-mono">
              {app.rules_signed_ip && (
                <div><span className="text-gray-500">IP:</span> <span className="text-gray-900">{app.rules_signed_ip}</span></div>
              )}
              {app.rules_signed_geolocation && (
                <div>
                  <span className="text-gray-500">Location:</span>{' '}
                  <a
                    href={`https://www.google.com/maps?q=${app.rules_signed_geolocation.lat},${app.rules_signed_geolocation.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#f26a1b] hover:underline"
                  >
                    {app.rules_signed_geolocation.lat.toFixed(5)}, {app.rules_signed_geolocation.lon.toFixed(5)}
                  </a>{' '}
                  <span className="text-gray-400">(±{Math.round(app.rules_signed_geolocation.accuracy_meters)}m, captured {new Date(app.rules_signed_geolocation.timestamp_ms).toLocaleString()})</span>
                </div>
              )}
              {app.rules_signed_user_agent && (
                <div className="break-all"><span className="text-gray-500">User-Agent:</span> <span className="text-gray-700">{app.rules_signed_user_agent}</span></div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Documents */}
      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
          Documents
        </h3>
        <div className="flex flex-wrap gap-3">
          {docLinks.map(({ label, url }) =>
            url ? (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded border border-[#f26a1b] px-3 py-1.5 text-sm text-[#f26a1b] hover:bg-orange-50 transition-colors"
              >
                {label} ↗
              </a>
            ) : (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-400"
              >
                {label} — not submitted
              </span>
            )
          )}
        </div>
      </section>

      {/* Background check placeholder */}
      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
          Background Check
        </h3>
        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800">
          Applycheck: Pending
        </span>
      </section>

      {/* Board decision */}
      <section>
        <h3 className="text-sm font-semibold text-[#0d0d0d] uppercase tracking-wide mb-3">
          Board Decision
        </h3>
        <div className="space-y-4">
          {/* Send to Board Review */}
          {(!app.board_decision || app.board_decision === 'pending') && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded border border-blue-100">
              <button
                onClick={handleSendToBoard}
                disabled={sendingToBoard}
                className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {sendingToBoard ? 'Sending…' : 'Send to Board Review'}
              </button>
              <span className="text-xs text-blue-600">
                Emails board members a secure review link
              </span>
              {sendToBoardResult && (
                <span className="text-sm text-green-600 font-medium">✓ {sendToBoardResult}</span>
              )}
              {sendToBoardError && (
                <span className="text-sm text-red-600">{sendToBoardError}</span>
              )}
            </div>
          )}
          {app.board_decision === 'board_review' && (
            <div className="p-3 bg-blue-50 rounded border border-blue-100 text-sm text-blue-700">
              <span className="font-medium">Board Review in progress</span> — review links have been sent to board members.
              {sendToBoardResult && (
                <span className="ml-2 text-green-600 font-medium">✓ {sendToBoardResult}</span>
              )}
              {sendToBoardError && (
                <span className="ml-2 text-red-600">{sendToBoardError}</span>
              )}
              <button
                onClick={handleSendToBoard}
                disabled={sendingToBoard}
                className="ml-3 px-3 py-1 rounded border border-blue-400 text-blue-700 text-xs hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                {sendingToBoard ? 'Resending…' : 'Resend'}
              </button>
            </div>
          )}

          {/* Decision buttons */}
          <div className="flex gap-3">
            {(['approved', 'rejected', 'pending'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDecision(d)}
                className={`px-4 py-2 rounded text-sm font-medium border transition-colors ${
                  decision === d
                    ? d === 'approved'
                      ? 'bg-green-600 text-white border-green-600'
                      : d === 'rejected'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-gray-700 text-white border-gray-700'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                }`}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>

          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Board notes (optional)..."
            rows={3}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#f26a1b] focus:outline-none focus:ring-1 focus:ring-[#f26a1b] resize-none"
          />

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded bg-[#f26a1b] text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Decision'}
            </button>
            {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
            {saveError && <span className="text-sm text-red-600">{saveError}</span>}
          </div>

          {app.board_decided_at && (
            <p className="text-xs text-gray-400">
              Last updated: {fmtDate(app.board_decided_at)}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main table component
// ---------------------------------------------------------------------------

export function ApplicationsTable({ applications: initialApps, documentLookup }: Props) {
  const [apps, setApps] = useState<Application[]>(initialApps);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === 'all') return apps;
    if (filter === 'pending') return apps.filter((a) => !a.board_decision || a.board_decision === 'pending');
    if (filter === 'board_review') return apps.filter((a) => a.board_decision === 'board_review');
    return apps.filter((a) => a.board_decision === filter);
  }, [apps, filter]);

  function handleDecisionSaved(id: string, updated: Partial<Application>) {
    setApps((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updated } : a))
    );
  }

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending Review' },
    { key: 'board_review', label: 'Board Review' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ];

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filter === t.key
                ? 'border-[#f26a1b] text-[#f26a1b]'
                : 'border-transparent text-gray-500 hover:text-[#0d0d0d]'
            }`}
          >
            {t.label}
            <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {t.key === 'all'
                ? apps.length
                : t.key === 'pending'
                ? apps.filter((a) => !a.board_decision || a.board_decision === 'pending').length
                : apps.filter((a) => a.board_decision === t.key).length}
            </span>

          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-gray-500 text-sm py-8 text-center">No applications in this category.</p>
      )}

      {/* Application rows */}
      <div className="rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-200">
        {filtered.map((app) => {
          const isOpen = expandedId === app.id;
          return (
            <div key={app.id}>
              {/* Row */}
              <div
                className={`bg-white px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 ${
                  isOpen ? 'border-l-4 border-[#f26a1b]' : 'border-l-4 border-transparent'
                }`}
              >
                {/* Reference */}
                <div className="w-36 shrink-0">
                  <p className="text-xs text-gray-400">Reference</p>
                  <p className="font-mono text-sm font-semibold text-[#0d0d0d]">{refId(app.id)}</p>
                </div>

                {/* Association */}
                <div className="flex-1 min-w-[140px]">
                  <p className="text-xs text-gray-400">Association</p>
                  <p className="text-sm font-medium text-[#0d0d0d] truncate">{app.association ?? '—'}</p>
                </div>

                {/* Applicant name */}
                <div className="flex-1 min-w-[140px]">
                  <p className="text-xs text-gray-400">Applicant</p>
                  <p className="text-sm text-[#0d0d0d] truncate">{getApplicantName(app)}</p>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <AppTypeBadge type={app.app_type} />
                  <PaymentBadge status={app.stripe_payment_status} />
                  <DecisionBadge decision={app.board_decision} />
                </div>

                {/* Date */}
                <div className="w-28 shrink-0 text-right">
                  <p className="text-xs text-gray-400">Submitted</p>
                  <p className="text-sm text-[#0d0d0d]">{fmtDate(app.created_at)}</p>
                </div>

                {/* View button */}
                <button
                  onClick={() => setExpandedId(isOpen ? null : app.id)}
                  className="ml-auto shrink-0 px-3 py-1.5 rounded border border-gray-300 text-sm text-gray-700 hover:border-[#f26a1b] hover:text-[#f26a1b] transition-colors"
                >
                  {isOpen ? 'Close' : 'View'}
                </button>
              </div>

              {/* Inline detail panel */}
              {isOpen && (
                <DetailPanel
                  app={app}
                  documentLookup={documentLookup}
                  onDecisionSaved={(updated) => handleDecisionSaved(app.id, updated)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
