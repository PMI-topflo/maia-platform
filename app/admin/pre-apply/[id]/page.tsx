'use client'

// Staff Pre-Application audit view (B4 slice 3). Review one submitted intake:
// the applicant, the per-type checklist vs what was uploaded, each document
// (preview), the signed rules acknowledgment, and the Drive folder. Advance it:
// audit (PMI/Jonathan) → approve (on-site manager OR board) or decline.

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { APPLICANT_ROLES, applicantRoleLabel } from '@/lib/applicant-roles'

interface Doc { id: string; doc_key: string | null; doc_label: string | null; filename: string; mime_type: string | null; url: string | null; suggestedName: string | null; expirationDate: string | null; noExpiration: boolean; bySource: string | null; stakeholderId: string | null }
interface Detail {
  id: string; associationCode: string; type: string; unit: string | null; status: string; submittedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  ownerName: string | null; ownerEmails: string | null; tenantEmail: string | null
  stakeholders?: { id: string; role: string; roleLabel: string; name: string | null; email: string | null; phone: string | null; isPrimary: boolean; status: string; signs: boolean; signedAt: string | null; rulesAckName: string | null; emailVerified: boolean; applicantRole: string | null; creditScore: number | null }[]
  rulesAck: { name?: string; at?: string } | null
  driveFolderUrl: string | null
  screeningProvider: string
  audit: { auditedBy: string | null; auditedAt: string | null; reviewedBy: string | null; reviewedAt: string | null; note: string | null; approvedByRole: string | null }
  naItems: string[]
  currentLease: { tenantName: string | null; tenantEmail: string | null; tenantPhone: string | null; leaseStart: string | null; leaseEnd: string | null; approvedAt: string | null; approvedApplicationId: string | null; documents: { docKey: string; label: string; url: string }[] } | null
  review: {
    rows: { scopeKey: string; docKey: string; state: 'waiting' | 'received' | 'approved' | 'refused'; decision: { by: string; role: string; at: string; reason: string | null } | null; perApplicantName: string | null }[]
    totals: { required: number; received: number; decided: number; approved: number; refused: number; waiting: number }
    complete: boolean; windowOpenedAt: string | null; windowDays: number; dueAt: string | null
  } | null
  declarations: { vehicle?: { has: boolean; at?: string } | null; animal?: { has: boolean; kind?: 'pet' | 'service' | 'esa' | 'unsure' | null; at?: string } | null }
  declaredNa: string[]
  petsAllowed: boolean | null
  petsProhibitedNotice: boolean
  animalGuidance: { heading: string; intro: string; mayRequest: string[]; mustNotRequest: string[]; staffNote: string } | null
  assistanceAnimalDenialGrounds: string[]
  assistanceAnimalDecisionDays: number
  checklist: { doc_key: string; label: string; required: boolean; provided_by: string; per_applicant: boolean; allow_multiple: boolean; uploaded: boolean; condition_key: string | null; template_path: string | null }[]
  documents: Doc[]
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }

// Checklist items that are FORMS MAIA generates and the resident e-signs —
// never something anybody can upload. Kept in step with the authoritative list
// in lib/application-esign-forms.ts, which is what actually sends them; this
// copy exists so the client bundle doesn't pull in the server-only module.
// landlord_tenant_agreement is its OWN e-signed packet (lib/lease-packet.ts,
// owner + tenant both sign), not the generic single-kind form the other
// three use — but staff-facing, it's the same story: MAIA sends it, there
// is no upload button, no Owner/Tenant/Both to pick.
const ESIGN_ITEM_KEYS = new Set(['governing_docs_ack', 'pet_registration', 'emergency_contact', 'landlord_tenant_agreement'])
const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '—'

export default function PreApplyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [tax, setTax] = useState<{ kind: string; confidence: number; verdict: string } | null>(null)
  const [taxBusy, setTaxBusy] = useState(false)
  const [driveFiles, setDriveFiles] = useState<{ fileId: string; name: string; mimeType: string }[] | null>(null)
  const [driveFilesErr, setDriveFilesErr] = useState<string | null>(null)
  const [activeApplicant, setActiveApplicant] = useState<string | null>(null)
  // "Request it" on a row opens the request panel with that item preselected —
  // staff still choose WHO it goes to.
  const [requestFor, setRequestFor] = useState<{ doc_key: string; label: string } | null>(null)

  const loadDriveFiles = useCallback(async () => {
    setDriveFilesErr(null)
    // The route always answers 200 — a genuine Drive failure comes back as
    // {files: [], error: "..."}, not a non-OK status. This used to read only
    // .files, so a Drive error looked identical to a folder that's simply
    // empty. User report, 2026-08-19: "From Drive" felt "silent."
    const r = await fetch(`/api/admin/pre-apply/${id}/drive-files`, { credentials: 'include' })
    const j = await r.json()
    setDriveFiles(Array.isArray(j.files) ? j.files : [])
    if (j.error) setDriveFilesErr(String(j.error))
  }, [id])

  async function runTaxCheck() {
    setTaxBusy(true); setTax(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/tax-check`, { method: 'POST', credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); setTax(j)
    } catch (e) { alert(`Tax check: ${(e as Error).message}`) } finally { setTaxBusy(false) }
  }

  const load = useCallback(() => {
    fetch(`/api/admin/pre-apply/${id}`, { credentials: 'include' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j })
      .then(setD).catch(e => setErr(String(e.message ?? e)))
  }, [id])
  useEffect(load, [load])

  // Tells the globally-mounted MAIA widget (components/FloatingWidget.tsx)
  // which application this page is on, so it can surface the "@maia upapp
  // <ACCOUNT>" forward-to-file shortcut without a second fetch of its own —
  // this page already has the association code and unit. Cleared on unmount
  // so it doesn't survive onto whatever page comes next. User direction,
  // 2026-08-21.
  useEffect(() => {
    if (d?.associationCode && d?.unit) {
      window.dispatchEvent(new CustomEvent('maia:upapp-hint', { detail: { code: d.associationCode, unit: d.unit } }))
    }
    return () => { window.dispatchEvent(new CustomEvent('maia:upapp-hint', { detail: null })) }
  }, [d?.associationCode, d?.unit])

  async function act(action: string, by_role?: string) {
    if ((action === 'decline' || action === 'request') && !note.trim()) { alert('Add a note explaining what’s needed.'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, by_role, note }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed'); setNote(''); load()
    } catch (e) { alert(`Could not update: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  if (err) return <div style={wrap}><p style={{ color: '#991b1b' }}>{err}</p></div>
  if (!d) return <div style={wrap}><p style={{ color: '#9ca3af' }}>Loading…</p></div>

  const naSet = new Set(d.naItems ?? [])
  const applicants = (d.stakeholders ?? []).filter(s => s.role === 'applicant')
  const sharedItems = d.checklist.filter(c => !c.per_applicant)
  const perApplicantItems = d.checklist.filter(c => c.per_applicant)
  // A SHARED item (sid null) is satisfied by the document whoever uploaded it —
  // the applicant intake stamps the uploader's stakeholder_id on every file, so
  // requiring an unscoped row made shared items read "Missing" while the
  // document sat right there (MANXI 103 and 1002). Per-applicant items stay
  // strictly scoped to their person. Unscoped rows sort first.
  const docsFor = (docKey: string, sid: string | null) => sid
    ? d.documents.filter(x => x.doc_key === docKey && (x.stakeholderId ?? null) === sid)
    : d.documents.filter(x => x.doc_key === docKey).sort((a, b) => Number(!!a.stakeholderId) - Number(!!b.stakeholderId))
  const docFor = (docKey: string, sid: string | null) => docsFor(docKey, sid)[0]
  // A BARE doc_key in naItems means "applies to nobody on this application" —
  // that's how the applicant's own declaration is expressed ("I keep no
  // vehicle"), so it must retire the per-applicant rows too, not just the
  // shared one. A `docKey#stakeholderId` entry stays scoped to that person.
  const reviewFor = (docKey: string, sid: string | null) =>
    (d.review?.rows ?? []).find(r => r.scopeKey === (sid ? `${docKey}#${sid}` : docKey)) ?? null
  const scopeKeyOf = (docKey: string, sid: string | null) => sid ? `${docKey}#${sid}` : docKey
  const naFor = (docKey: string, sid: string | null) => naSet.has(docKey) || (!!sid && naSet.has(`${docKey}#${sid}`))
  // A document row existing is not the same as it being SATISFIED — a refused
  // document still has a row (it's on file, just sent back), so "no row" alone
  // undercounted what's actually outstanding. Real case, 2026-08-20: MANXI 912's
  // Property Insurance was refused ("this is the renters insurance, we need the
  // property insurance from the owner") but never showed as missing here, so it
  // never got pre-ticked in the request panel and the refusal reason never went
  // back out to the owner.
  const isRefused = (docKey: string, sid: string | null) => reviewFor(docKey, sid)?.state === 'refused'
  const notSatisfied = (docKey: string, sid: string | null) => (!docFor(docKey, sid) || isRefused(docKey, sid)) && !naFor(docKey, sid)
  // Missing required: shared items + each applicant's per-person items (minus N/A).
  const missing = [
    ...sharedItems.filter(c => c.required && notSatisfied(c.doc_key, null)),
    ...(applicants.length ? perApplicantItems.flatMap(c => c.required ? applicants.filter(a => notSatisfied(c.doc_key, a.id)).map(a => ({ label: `${c.label} — ${a.name ?? 'applicant'}` })) : []) : perApplicantItems.filter(c => c.required).map(c => ({ label: c.label }))),
  ]
  // What staff can request from owner/tenant (one row per checklist item).
  const isMissing = (c: Detail['checklist'][number]) => c.per_applicant
    ? (applicants.length === 0 || applicants.some(a => notSatisfied(c.doc_key, a.id)))
    : notSatisfied(c.doc_key, null)
  const isAnyRefused = (c: Detail['checklist'][number]) => c.per_applicant
    ? applicants.some(a => isRefused(c.doc_key, a.id))
    : isRefused(c.doc_key, null)
  // Ask the OWNER who is moving in. This must be offerable when the roster is
  // EMPTY — that's the case that needs it most. It used to require an applicant
  // to already exist, so on a unit with nobody on the roster the one item that
  // collects the tenants' details was hidden.
  const rosterMissing = applicants.length === 0 || applicants.some(a => !a.email || !a.phone)
  // Name the person we are actually asking about. "Tenant names, emails &
  // phone numbers" on an ADDITIONAL OCCUPANT application read as though we
  // wanted the existing tenant's details — which the owner already sent, and
  // which is how an occupant's paperwork came back carrying the tenant's
  // address. On this type it is one named person, and it is HIS OWN email:
  // email is identity here, for the OTP and the e-signature.
  const rosterLabel = (() => {
    const named = applicants.map(a => (a.name ?? '').trim()).filter(Boolean)
    if (d.type === 'additional_occupant') {
      return named.length === 1
        ? `${named[0]}'s OWN email & phone (the additional occupant — not the tenant's)`
        : "The additional occupant's name, and their OWN email & phone (not the tenant's)"
    }
    if (d.type === 'purchase') return 'Buyer names, emails & phone numbers'
    return 'Tenant names, emails & phone numbers'
  })()
  const requestItems = [
    { doc_key: 'tenant_contact_info', label: rosterLabel, provided_by: 'landlord', missing: rosterMissing, refused: false },
    ...d.checklist.map(c => ({ doc_key: c.doc_key, label: c.label, provided_by: c.provided_by, missing: c.required && isMissing(c), refused: isAnyRefused(c) })),
  ]
  // Only documents that belong to THIS application's checklist can raise the
  // expired alarm. Files the Drive scan pulled in that aren't part of this
  // application type (e.g. a previous tenant's lease on a purchase) show as
  // "extra" and must not flag the application as non-compliant.
  const checklistKeys = new Set(d.checklist.map(c => c.doc_key))
  const expiredDocs = d.documents.filter(x => x.doc_key && checklistKeys.has(x.doc_key) && x.expirationDate && !x.noExpiration && new Date(x.expirationDate) < new Date())
  const decided = d.status === 'approved' || d.status === 'declined'
  const hasLease = d.documents.some(x => x.doc_key === 'signed_lease')
  const reqCount = d.checklist.filter(c => c.required).length
  const missingCount = missing.length
  const steps = [
    { label: 'Lease & type', done: hasLease, meta: hasLease ? 'read' : 'scan the lease' },
    { label: 'Applicants', done: applicants.length > 0, meta: applicants.length ? `${applicants.length} · roles set` : 'read from lease' },
    { label: 'Documents', done: missingCount === 0, meta: `${reqCount - missingCount} of ${reqCount} required` },
    { label: 'Review & approve', done: decided, meta:
      d.status === 'approval_sent' ? 'letter sent — awaiting signatures'
      : d.review?.complete ? 'documents approved — letter next'
      : 'documents under review' },
  ]

  return (
    <div style={wrap}>
      <Link href="/admin/pre-apply" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>← Audit queue</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        {/* EVERY applicant, not just the lead. The header read the primary
            alone, so a co-applicant who was saved perfectly well was nowhere on
            the page above the fold — which looks exactly like not having saved.
            Same defect as the approval letter that went out naming one person
            on a two-person application. */}
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          {applicants.length > 0
            ? applicants.map(a => a.name).filter(Boolean).join(' & ') || 'Applicant'
            : (d.applicant?.name || 'Applicant')}
          <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 18 }}> · {TYPE_LABEL[d.type] ?? d.type}</span>
        </h1>
        {/* The Drive folder belongs at the TOP of the card. It was below the
            applicants and agents editors, where it read as a footnote to them
            rather than as the application's own folder, and was routinely
            missed in the middle of the page. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {d.driveFolderUrl && <a href={d.driveFolderUrl} target="_blank" rel="noreferrer" style={{ font: '600 13px system-ui', color: '#2563eb', textDecoration: 'none', border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 8, padding: '5px 11px', whiteSpace: 'nowrap' }}>📁 Drive folder →</a>}
          <StatusPill status={d.status} />
        </div>
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '2px 0 0' }}>{d.associationCode}{d.unit ? ` · Unit ${d.unit}` : ''} · submitted {fmt(d.submittedAt)}</p>
      <p style={{ fontSize: 13, color: '#374151', margin: '4px 0 0' }}>{d.applicant?.email}{d.applicant?.phone ? ` · ${d.applicant.phone}` : ''}</p>
      {/* `name` is the LEAD applicant, which is what this editor renames. The
          others are named beside it so the line matches the roster. */}
      <MetaEditor id={id} name={d.applicant?.name ?? ''} others={applicants.slice(1).map(a => a.name).filter((n): n is string => !!n)} type={d.type} onDone={load} />
      <ApplicantsCard id={id} applicants={(d.stakeholders ?? []).filter(s => s.role === 'applicant')} onDone={load} />
      <AgentsCard id={id} stakeholders={d.stakeholders ?? []} onDone={load} />

      {/* Guided progress */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '16px 0 6px' }}>
        {steps.map((s, i) => (
          <div key={i} style={{ flex: '1 1 150px', minWidth: 140, border: `1px solid ${s.done ? '#bbf7d0' : '#e5e7eb'}`, background: s.done ? '#f0fdf4' : '#fff', borderRadius: 10, padding: '9px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: '800 11px system-ui', color: '#fff', background: s.done ? '#16a34a' : '#9ca3af' }}>{s.done ? '✓' : i + 1}</span><span style={{ font: '700 13px system-ui', color: '#1f2937' }}>{s.label}</span></div>
            <div style={{ font: '11.5px system-ui', color: '#9ca3af', marginTop: 3 }}>{s.meta}</div>
          </div>
        ))}
      </div>

      {/* Missing contact — MAIA can't reach these people (requests, approval letter). */}
      {(() => {
        const noEmail = applicants.filter(a => !a.email)
        const noPhone = applicants.filter(a => a.email && !a.phone)
        if (noEmail.length === 0 && noPhone.length === 0) return null
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: noEmail.length ? '#fef2f2' : '#fffbeb', border: `1px solid ${noEmail.length ? '#b91c1c' : '#fbbf24'}`, borderLeft: `4px solid ${noEmail.length ? '#b91c1c' : '#f59e0b'}`, borderRadius: 10, padding: '11px 14px', margin: '12px 0' }}>
            <span style={{ fontSize: 20 }}>{noEmail.length ? '🚨' : '⚠'}</span>
            <div style={{ flex: 1, fontSize: 13.5, color: noEmail.length ? '#7f1d1d' : '#92400e' }}>
              {noEmail.length > 0 && <div><b>No email on file for {noEmail.map(a => a.name || 'an applicant').join(', ')}.</b> MAIA cannot send them document requests or the approval letter — add it on the Applicants card above.</div>}
              {noPhone.length > 0 && <div style={{ marginTop: noEmail.length ? 4 : 0 }}>No phone for {noPhone.map(a => a.name || 'an applicant').join(', ')} — add it so MAIA can text/WhatsApp them.</div>}
            </div>
          </div>
        )
      })()}

      {/* MAIA screams on expired files */}
      {expiredDocs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fef2f2', border: '1px solid #b91c1c', borderLeft: '4px solid #b91c1c', borderRadius: 10, padding: '11px 14px', margin: '12px 0' }}>
          <span style={{ fontSize: 20 }}>🚨</span>
          <div style={{ flex: 1, fontSize: 13.5, color: '#7f1d1d' }}><b>{expiredDocs.length} expired document{expiredDocs.length === 1 ? '' : 's'}.</b> {expiredDocs.map(x => `${x.doc_label || x.filename} (expired ${new Date(x.expirationDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`).join(', ')}. Request current copies below before this can move forward.</div>
        </div>
      )}

      {/* An additional occupant is joining a lease that already exists. Show it
          — the tenant of record, the term, and links to the approved
          application's own documents — rather than copying those files onto
          this application, where they would drift and carry a stale expiry. */}
      {d.currentLease && (
        <div style={{ border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 10, padding: '12px 14px', margin: '12px 0' }}>
          <div style={{ font: '700 12px system-ui', color: '#1e3a5f', textTransform: 'uppercase', letterSpacing: '.06em' }}>Current lease on this unit</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 6, fontSize: 13.5, color: '#374151' }}>
            {d.currentLease.tenantName && <span>👤 Approved tenant: <strong>{d.currentLease.tenantName}</strong></span>}
            {(d.currentLease.leaseStart || d.currentLease.leaseEnd) && (
              <span>📅 Term: <strong>{d.currentLease.leaseStart ?? '—'} → {d.currentLease.leaseEnd ?? '—'}</strong></span>
            )}
            {d.currentLease.approvedAt && <span>🏛 Board approved {fmt(d.currentLease.approvedAt)}</span>}
          </div>
          {(d.currentLease.tenantEmail || d.currentLease.tenantPhone) && (
            <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 4 }}>
              {d.currentLease.tenantEmail}{d.currentLease.tenantPhone ? ` · ${d.currentLease.tenantPhone}` : ''}
            </div>
          )}
          {d.currentLease.documents.length > 0 && (
            <div style={{ fontSize: 12.5, color: '#374151', marginTop: 7 }}>
              On the approved lease:{' '}
              {d.currentLease.documents.map((x, i) => (
                <span key={x.docKey}>{i ? ' · ' : ''}<a href={x.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>{x.label}</a></span>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 6 }}>
            Shown, not copied — these stay on the approved lease so there is only ever one of each.
          </div>
        </div>
      )}

      {/* What the applicant declared about themselves — vehicle and animal.
          These retire the matching checklist items, so staff need to see the
          answer that did it rather than wondering why a row went N/A.
          ALWAYS shown when the checklist has a conditional item at all (not
          only once answered) — this stays editable here too as a fallback
          (an answer that came in some other way than the resident's own
          link), even though the normal path is now the resident answering
          these as real Yes/No controls on their own /request/[token] link
          (app/api/request/[token]/declare/route.ts) rather than replying to
          an email in prose. */}
      {d.checklist.some(c => c.condition_key === 'vehicle' || c.condition_key === 'pet' || c.condition_key === 'assistance_animal') && (
        <DeclarationsCard
          id={id} declarations={d.declarations} declaredNa={d.declaredNa}
          petsProhibitedNotice={d.petsProhibitedNotice} animalGuidance={d.animalGuidance}
          assistanceAnimalDenialGrounds={d.assistanceAnimalDenialGrounds} assistanceAnimalDecisionDays={d.assistanceAnimalDecisionDays}
          onDone={load}
        />
      )}

      {/* Checklist — with staff upload boxes so you can file a doc you got by email */}
      <h2 style={h2}>Documents ({d.documents.length} uploaded)</h2>
      <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 8px' }}>Upload a document you received directly here — MAIA files it into this unit&apos;s <strong>On Going Applications</strong> Drive folder. (Official only after board approval.)</p>
      {d.driveFolderUrl && <ScanDrive id={id} onDone={load} />}
      {/* Documents saved in MAIA but not yet in Drive (uploaded before uploads
          auto-mirrored, or a mirror that failed while Drive was unreachable). */}
      {d.documents.length > 0 && !d.driveFolderUrl && (
        <div style={{ margin: '0 0 10px' }}>
          <button onClick={async () => {
            setBusy(true)
            try {
              const r = await fetch(`/api/admin/pre-apply/${id}/mirror-drive`, { method: 'POST', credentials: 'include' })
              const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'failed')
              alert(`Sent ${j.documents} document(s) to the unit's On Going Applications folder.`); load()
            } catch (e) { alert(`Could not send to Drive: ${(e as Error).message}`) } finally { setBusy(false) }
          }} disabled={busy} style={{ ...btn('#0f766e'), padding: '8px 14px' }}>📤 Send these documents to Drive</button>
          <p style={{ font: '12px system-ui', color: '#9ca3af', margin: '5px 0 0' }}>These {d.documents.length} document(s) are saved in MAIA but no Drive folder exists for this application yet.</p>
        </div>
      )}
      {(d.type === 'lease_renewal' || d.type === 'additional_occupant') && <CarryOverButton id={id} onDone={load} />}
      {missing.length > 0 && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, font: '13px system-ui', color: '#92400e', marginBottom: 10 }}>⚠ Missing required: {missing.map(m => m.label).join(', ')}</div>}
      {!decided && <RulesAckSender id={id} />}
      {!decided && <PetRegSender id={id} />}
      {!decided && <TenantEvalSender id={id} />}
      <CommunicationsLog id={id} unit={d.unit} associationCode={d.associationCode} />

      {/* Shared documents — one for the whole unit / application. */}
      <div style={{ font: '700 12px system-ui', letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', margin: '2px 0 6px' }}>Shared documents</div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        {sharedItems.map((c, i) => (
          <ChecklistRow key={c.doc_key} id={id} c={c} doc={docFor(c.doc_key, null)} extraDocs={docsFor(c.doc_key, null).slice(1)} na={naFor(c.doc_key, null)} first={i === 0} decided={decided} onDone={load} driveFiles={driveFiles} driveFilesErr={driveFilesErr} loadDriveFiles={loadDriveFiles} checklist={d.checklist.map(x => ({ doc_key: x.doc_key, label: x.label }))} assoc={d.associationCode} appType={d.type} hasExample={!!c.template_path}
                        review={reviewFor(c.doc_key, null)} scopeKey={scopeKeyOf(c.doc_key, null)} onRequest={(k, l) => setRequestFor({ doc_key: k, label: l })} />
        ))}
        {d.documents.filter(doc => !doc.stakeholderId && !d.checklist.some(c => c.doc_key === doc.doc_key)).map(doc => (
          <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderTop: '1px solid #f3f4f6', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{doc.doc_label || doc.filename} <span style={{ fontSize: 11, color: '#9ca3af' }}>· not required for this application type</span>{doc.expirationDate && !doc.noExpiration && new Date(doc.expirationDate) < new Date() && <span style={{ font: '600 10.5px system-ui', color: '#9ca3af', marginLeft: 6 }}>expired {new Date(doc.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}</span>
            {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>✓ View</a>}
          </div>
        ))}
      </div>

      {/* Per-applicant documents — one column per applicant. */}
      {perApplicantItems.length > 0 && (
        <>
          <div style={{ font: '700 12px system-ui', letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', margin: '18px 0 6px' }}>Per-applicant documents</div>
          {applicants.length === 0 ? (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, font: '13px system-ui', color: '#92400e' }}>Add the applicants above (read them from the lease) to collect each person&apos;s documents in their own tab.</div>
          ) : (() => {
            const activeId = applicants.some(a => a.id === activeApplicant) ? activeApplicant! : applicants[0].id
            const a = applicants.find(x => x.id === activeId)!
            const missingCount = (sid: string) => perApplicantItems.filter(c => c.required && notSatisfied(c.doc_key, sid)).length
            return (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                {/* Applicant tabs */}
                <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                  {applicants.map(x => {
                    const on = x.id === activeId
                    const miss = missingCount(x.id)
                    return (
                      <button key={x.id} onClick={() => setActiveApplicant(x.id)} style={{ border: 'none', borderBottom: on ? '2px solid #4338ca' : '2px solid transparent', background: on ? '#fff' : 'transparent', cursor: 'pointer', padding: '9px 16px', textAlign: 'left' }}>
                        <div style={{ font: `${on ? 700 : 600} 14px system-ui`, color: on ? '#1f2937' : '#6b7280' }}>{x.name || 'Applicant'}{miss > 0 && <span style={{ font: '600 10px system-ui', color: '#fff', background: '#f59e0b', borderRadius: 999, padding: '1px 6px', marginLeft: 6 }}>{miss}</span>}</div>
                        <div style={{ font: '600 11px system-ui', color: '#9ca3af' }}>{applicantRoleLabel(x.applicantRole) || (x.isPrimary ? 'Primary Applicant' : 'Co-Applicant')}</div>
                      </button>
                    )
                  })}
                </div>
                {/* Background-check credit score for the active applicant. */}
                <CreditScore id={id} stakeholderId={a.id} name={a.name} score={a.creditScore} decided={decided} onDone={load} />
                {/* Active applicant's documents */}
                {perApplicantItems.map((c, i) => (
                  <ChecklistRow key={c.doc_key} id={id} c={c} doc={docFor(c.doc_key, a.id)} extraDocs={docsFor(c.doc_key, a.id).slice(1)} na={naFor(c.doc_key, a.id)} first={i === 0} decided={decided} onDone={load} driveFiles={driveFiles} driveFilesErr={driveFilesErr} loadDriveFiles={loadDriveFiles} stakeholderId={a.id} applicants={applicants.map(x => ({ id: x.id, name: x.name }))} checklist={d.checklist.map(x => ({ doc_key: x.doc_key, label: x.label }))} assoc={d.associationCode} appType={d.type} hasExample={!!c.template_path}
                        review={reviewFor(c.doc_key, a.id)} scopeKey={scopeKeyOf(c.doc_key, a.id)} onRequest={(k, l) => setRequestFor({ doc_key: k, label: l })} />
                ))}
              </div>
            )
          })()}
        </>
      )}

      {/* Request documents — BELOW both document lists, because "which of these
          do I still need?" is a question you answer by reading the lists first.
          Opening it above them pushed the very rows being ticked off-screen. */}
      {!decided && (
        <div style={{ marginTop: 16 }}>
          <RequestDocs id={id} items={requestItems} ownerName={d.ownerName} ownerEmails={d.ownerEmails} tenantEmail={d.tenantEmail}
            listingAgent={(d.stakeholders ?? []).find(s => s.role === 'listing_agent') ?? null}
            applicantAgent={(d.stakeholders ?? []).find(s => s.role === 'applicant_agent') ?? null}
            onDone={load} preselect={requestFor} onPreselectHandled={() => setRequestFor(null)} />
        </div>
      )}

      {/* Tax-return-vs-W-2 check (the one real validation) */}
      {d.checklist.some(c => /tax/i.test(c.label)) && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={taxBusy} onClick={runTaxCheck} style={{ ...btn('#4338ca'), padding: '7px 12px' }}>{taxBusy ? 'Checking…' : 'Check tax doc (is it a return, not a W-2?)'}</button>
          {tax && (
            <span style={{ font: '600 13px system-ui', color: tax.verdict === 'ok' ? '#166534' : tax.verdict === 'w2' ? '#b91c1c' : '#b45309' }}>
              {tax.verdict === 'ok' ? '✓ Looks like a tax return' : tax.verdict === 'w2' ? '⚠ This is a W-2, not a tax return' : tax.verdict === 'unknown' ? 'Could not read it' : '⚠ Not a tax return (' + tax.kind + ')'}
              {tax.confidence ? ` · ${Math.round(tax.confidence * 100)}%` : ''}
            </span>
          )}
        </div>
      )}

      {/* People on this application + who signed the rules */}
      <h2 style={h2}>People on this application</h2>
      {d.stakeholders && d.stakeholders.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {d.stakeholders.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: '#374151', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
              <span><strong>{p.name || p.email || '—'}</strong> <span style={{ color: '#6b7280' }}>· {p.roleLabel}</span>{p.isPrimary && <span style={{ color: '#9ca3af' }}> · lead</span>}{p.email && <span style={{ color: '#9ca3af' }}> · {p.email}</span>}{p.emailVerified && <span style={{ color: '#166534' }}> · ✓ verified</span>}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{p.signs ? (p.signedAt ? <span style={{ color: '#166534', fontWeight: 600 }}>✍ signed{p.rulesAckName ? ` — ${p.rulesAckName}` : ''}</span> : <span style={{ color: '#b45309' }}>not signed</span>) : <span style={{ color: '#9ca3af' }}>no signature needed</span>}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: '#374151' }}>{d.rulesAck?.name ? <>Rules signed by <strong>{d.rulesAck.name}</strong> · {fmt(d.rulesAck.at)}</> : <span style={{ color: '#b45309' }}>Not signed</span>}</p>
      )}

      {/* Board approval — files keepers to Official + archives the folder */}
      {!decided && <BoardApprove id={id} onDone={load} />}
      {d.status === 'approved' && <RefileOfficial id={id} onDone={load} />}

      {/* Board approval letter (Decision Page) — available after PMI's review so
          you can generate it, view it, and send it to the board for signatures. */}
      {['submitted', 'under_review', 'approval_sent', 'approved'].includes(d.status) && <DecisionPageSender id={id} unit={d.unit} />}

      {/* Audit trail */}
      {(d.audit.auditedAt || d.audit.reviewedAt) && (
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6 }}>
          {d.audit.auditedAt && <div>Audited by {d.audit.auditedBy} · {fmt(d.audit.auditedAt)}</div>}
          {d.audit.reviewedAt && <div>{d.status === 'approved' ? `Approved (${d.audit.approvedByRole})` : 'Decided'} by {d.audit.reviewedBy} · {fmt(d.audit.reviewedAt)}{d.audit.note ? ` — ${d.audit.note}` : ''}</div>}
        </div>
      )}

      {/* Where the application stands, and what to do next.
          The old block asked for an application-wide verdict — "Request more"
          with a hand-typed note — which never said WHICH document was wrong.
          Decisions now live on the documents themselves; this summarises them
          and pushes the outstanding ones into a request. */}
      {!decided && d.review && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', marginTop: 6, flex: 'none', background: d.review.complete ? '#0f7a4d' : '#b45309' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: d.review.complete ? '#0f7a4d' : '#b45309' }}>
                {d.review.complete && d.review.dueAt
                  ? `All documents approved — board decision due ${fmt(d.review.dueAt)}`
                  : `${d.review.totals.decided} of ${d.review.totals.required} decided${d.review.totals.waiting ? ` · ${d.review.totals.waiting} still to arrive` : ''}${d.review.totals.refused ? ` · ${d.review.totals.refused} refused` : ''}`}
              </div>
              <div style={{ fontSize: 13.5, color: '#4a5265', marginTop: 3 }}>
                The Board may decide up to {d.review.windowDays} days after the last requested document is received.
                {!d.review.complete && ' The window opens once every document is in and approved.'}
              </div>
            </div>
          </div>

          {/* Everything from here forward is automatic — every required
              document approved creates + sends the board decision letter;
              every signer signing it files to Official/Archive and marks
              approved (see the panels below). Decline is the one place a
              real decision remains for staff to make by hand. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 13, alignItems: 'center' }}>
            {(d.review.totals.waiting > 0 || d.review.totals.refused > 0) && (
              <button disabled={busy} onClick={() => setRequestFor({ doc_key: '__outstanding__', label: 'outstanding' })} style={btn('#b45309')}>
                📨 Request the {d.review.totals.waiting + d.review.totals.refused} outstanding
              </button>
            )}
            <BoardReviewSender id={id} onDone={load} />
            <span style={{ flex: 1 }} />
            <button disabled={busy} onClick={() => { if (!note.trim()) { alert('Add a note explaining why.'); return } act('decline') }} style={btn('#b91c1c')}>⛔ Decline the application</button>
          </div>
          <p style={{ fontSize: 12.5, color: '#6b7280', marginTop: 10 }}>
            {d.review.complete
              ? 'Every document is approved — MAIA creates and sends the board decision letter automatically. Once signed, it files to Official/Archive and marks this approved.'
              : 'Once every document is approved, MAIA automatically creates and sends the board decision letter, then files to Official/Archive and marks this approved as soon as it’s signed. No manual step needed unless you’re declining.'}
          </p>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note — required to decline the whole application. To send one document back, use Refuse on its row instead." style={{ width: '100%', boxSizing: 'border-box', minHeight: 46, padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, marginTop: 10 }} />
          <p style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 8 }}>
            On approval this hands off to{' '}
            <strong>{d.screeningProvider === 'maia_checkr' ? 'MAIA + Checkr' : 'Tenant Evaluation (current system)'}</strong> for the background check — change per association on the Association Hub.
          </p>
        </div>
      )}
    </div>
  )
}

interface DecSigner { name: string | null; email: string | null; role?: string | null; hasSignature: boolean }
interface DecPending { docId: string; status: string; createdAt: string; pdfUrl: string; signers: { name: string | null; email: string | null; signed: boolean; link: string | null }[] }
interface DecPrefill { applicationType: string; propertyAddress: string | null; applicant: string | null; requiredSignatures: number; defaultSigners: DecSigner[]; leaseStart: string | null; leaseEnd: string | null; occupants: string[]; applicantAsOccupant: string | null; pending?: DecPending | null }
interface DecResult { allSigned: boolean; pdfUrl: string; docId?: string; signers: { name: string | null; email: string | null; signed: boolean; link: string | null }[] }

// Generates the Board Decision Page (the approval letter). Defaults the signer
// to the President; if they have an on-file signature it's signed instantly,
// else a signing link is returned. Full address, occupants, and lease term
// prefill from the association + unit records.
// Send the Rules Knowledge Acknowledgment for e-signature. Every adult on the
// roster gets their own link — the association's Rules require a copy signed by
// all parties who will occupy.
interface RulesAckInfo {
  associationLegalName: string; propertyAddress: string | null
  signers: { name: string; email: string | null }[]
  blockers: string[]
  existing: { id: string; status: string; createdAt: string; signers: { role: string; name?: string | null; signed_at?: string }[] } | null
}
function RulesAckSender({ id }: { id: string }) {
  const [info, setInfo] = useState<RulesAckInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ name: string; email: string | null; link: string }[] | null>(null)
  const load = useCallback(() => { fetch(`/api/admin/pre-apply/${id}/rules-ack`, { credentials: 'include' }).then(r => r.json()).then(setInfo).catch(() => setInfo(null)) }, [id])
  useEffect(load, [load])
  if (!info) return null

  const signedCount = (info.existing?.signers ?? []).filter(s => s.signed_at).length
  const total = (info.existing?.signers ?? []).length

  async function create() {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/rules-ack`, { method: 'POST', credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setSent(j.signers); load()
    } catch (e) { alert(`Could not create: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ margin: '4px 0 14px', border: '1px solid #ddd6fe', background: '#faf5ff', borderRadius: 10, padding: 12 }}>
      <div style={{ font: '700 13px system-ui', color: '#5b21b6', marginBottom: 4 }}>📜 Rules Knowledge Acknowledgment</div>
      {info.existing ? (
        <div style={{ font: '12.5px system-ui', color: '#374151' }}>
          {info.existing.status === 'completed'
            ? <span style={{ color: '#166534', fontWeight: 600 }}>✓ Signed by all {total} — filed on the checklist.</span>
            : <>Sent {fmt(info.existing.createdAt)} · <strong>{signedCount}/{total} signed</strong>{(info.existing.signers ?? []).filter(s => !s.signed_at).length > 0 && <> · waiting on {(info.existing.signers ?? []).filter(s => !s.signed_at).map(s => s.name ?? s.role).join(', ')}</>}</>}
        </div>
      ) : info.blockers.length > 0 ? (
        <div style={{ font: '12.5px system-ui', color: '#92400e' }}>
          {info.blockers.map((b, i) => <div key={i}>⚠ {b}</div>)}
        </div>
      ) : (
        <>
          <div style={{ font: '12.5px system-ui', color: '#4b5563', marginBottom: 8 }}>
            Each adult signs their own block: {info.signers.map(s => s.name).join(', ')}. The association&apos;s own Rules and Regulations pages are included in the document.
          </div>
          <button onClick={create} disabled={busy} style={{ font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#6d28d9', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Creating…' : `✍ Send for signature (${info.signers.length})`}
          </button>
        </>
      )}
      {sent && (
        <div style={{ marginTop: 8, font: '12px system-ui', color: '#374151' }}>
          {sent.map((s, i) => <div key={i} style={{ marginTop: 3 }}><strong>{s.name}</strong> {s.email ? `(${s.email})` : ''} — <a href={s.link} target="_blank" rel="noreferrer" style={{ color: '#6d28d9' }}>signing link</a></div>)}
        </div>
      )}
    </div>
  )
}

// Pet Registration — optional, staff-triggered. The applicant fills in the pets
// themselves and e-signs; the completed form files onto the checklist with its
// own renewal expiry.
interface PetRegInfo {
  recipient: { name: string; email: string | null } | null
  petLimit: number
  blockers: string[]
  existing: { id: string; status: string; createdAt: string; signers: { role: string; name?: string | null; signed_at?: string }[] } | null
}
function TenantEvalSender({ id }: { id: string }) {
  interface Info { recipients: { name: string | null; email: string | null }[]; skipped: string[]; propertyCode: string | null; blockers: string[] }
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ sent: string[]; failed: string[] } | null>(null)
  const load = useCallback(() => { fetch(`/api/admin/pre-apply/${id}/tenant-evaluation`, { credentials: 'include' }).then(r => r.json()).then(setInfo).catch(() => setInfo(null)) }, [id])
  useEffect(load, [load])
  // No guide configured for this association at all — nothing useful to
  // offer, so the card doesn't take up space saying so on every application.
  if (!info || (info.blockers.length === 1 && info.blockers[0].startsWith('No Tenant Evaluation guide'))) return null

  async function send() {
    setBusy(true); setSent(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/tenant-evaluation`, { method: 'POST', credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setSent({ sent: j.sent, failed: j.failed }); load()
    } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ margin: '4px 0 14px', border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 10, padding: 12 }}>
      <div style={{ font: '700 13px system-ui', color: '#1e40af', marginBottom: 4 }}>🔎 Background / Credit Reports — ask them to apply <span style={{ font: '400 11.5px system-ui', color: '#9ca3af' }}>· via Tenant Evaluation</span></div>
      {info.blockers.length > 0 && !info.recipients.length ? (
        <div style={{ font: '12.5px system-ui', color: '#92400e' }}>{info.blockers.map((b, i) => <div key={i}>⚠ {b}</div>)}</div>
      ) : (
        <>
          <div style={{ font: '12.5px system-ui', color: '#4b5563', marginBottom: 8 }}>
            Emails {info.recipients.map(r => r.name ?? r.email).join(', ')} the step-by-step guide (property code {info.propertyCode}) to create their own Tenant Evaluation account and submit their background check — this is separate from uploading the finished report below.
            {info.skipped.length > 0 && <> Not sent to {info.skipped.join(', ')} — no email on file.</>}
          </div>
          <button onClick={send} disabled={busy} style={{ font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#1d4ed8', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Sending…' : `🔎 Send Tenant Evaluation guide (${info.recipients.length})`}
          </button>
        </>
      )}
      {sent && <div style={{ marginTop: 6, font: '12px system-ui', color: sent.sent.length ? '#166534' : '#b91c1c' }}>
        {sent.sent.length > 0 && `✓ Sent to ${sent.sent.join(', ')}`}{sent.failed.length > 0 && ` · could not send to ${sent.failed.join(', ')}`}
      </div>}
    </div>
  )
}

function PetRegSender({ id }: { id: string }) {
  const [info, setInfo] = useState<PetRegInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const load = useCallback(() => { fetch(`/api/admin/pre-apply/${id}/pet-registration`, { credentials: 'include' }).then(r => r.json()).then(setInfo).catch(() => setInfo(null)) }, [id])
  useEffect(load, [load])
  if (!info) return null

  async function send() {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/pet-registration`, { method: 'POST', credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setSent(j.sentTo); load()
    } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const signed = info.existing?.status === 'completed'
  return (
    <div style={{ margin: '4px 0 14px', border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 10, padding: 12 }}>
      <div style={{ font: '700 13px system-ui', color: '#9a3412', marginBottom: 4 }}>🐾 Pet Registration <span style={{ font: '400 11.5px system-ui', color: '#9ca3af' }}>· optional — only if the household has an animal</span></div>
      {info.existing ? (
        <div style={{ font: '12.5px system-ui', color: signed ? '#166534' : '#374151', fontWeight: signed ? 600 : 400 }}>
          {signed ? '✓ Signed — filed on the checklist with its renewal date.' : `Sent ${fmt(info.existing.createdAt)} · awaiting the applicant's form + signature.`}
        </div>
      ) : info.blockers.length > 0 ? (
        <div style={{ font: '12.5px system-ui', color: '#92400e' }}>{info.blockers.map((b, i) => <div key={i}>⚠ {b}</div>)}</div>
      ) : (
        <>
          <div style={{ font: '12.5px system-ui', color: '#4b5563', marginBottom: 8 }}>
            Emails {info.recipient?.name}{info.recipient?.email ? ` (${info.recipient.email})` : ''} a link to list their pets (limit {info.petLimit}) and e-sign. If they have none, mark the item N/A instead.
          </div>
          <button onClick={send} disabled={busy} style={{ font: '700 13px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#c05a1c', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Sending…' : '🐾 Send pet registration'}
          </button>
        </>
      )}
      {sent && <div style={{ marginTop: 6, font: '12px system-ui', color: '#166534' }}>✓ Sent to {sent}</div>}
    </div>
  )
}

function DecisionPageSender({ id, unit }: { id: string; unit: string | null }) {
  const [pf, setPf] = useState<DecPrefill | null>(null)
  const [decision, setDecision] = useState('Approved')
  const [conditions, setConditions] = useState('')
  const [leaseStart, setLeaseStart] = useState('')
  const [leaseEnd, setLeaseEnd] = useState('')
  const [occupants, setOccupants] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DecResult | null>(null)

  useEffect(() => {
    fetch(`/api/admin/pre-apply/${id}/decision-page`, { credentials: 'include' }).then(r => r.json()).then((d: DecPrefill) => {
      setPf(d); setLeaseStart(d.leaseStart ?? ''); setLeaseEnd(d.leaseEnd ?? '')
      const occ = d.occupants.length ? d.occupants : (d.applicantAsOccupant ? [d.applicantAsOccupant] : [])
      setOccupants(occ.join('\n'))
    }).catch(() => {})
  }, [id])

  const isLease = pf?.applicationType === 'lease' || pf?.applicationType === 'lease_renewal'
  const create = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/decision-page`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, conditions, leaseStart: isLease ? leaseStart : undefined, leaseEnd: isLease ? leaseEnd : undefined, occupants: occupants.split('\n').map(s => s.trim()).filter(Boolean), signers: pf?.defaultSigners.map(s => ({ name: s.name, email: s.email })) }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); setResult(j)
      // "Create & send" actually emails the board now (was a separate 2nd click before).
      if (j.docId && !j.allSigned) {
        const sr = await fetch(`/api/admin/pre-apply/${id}/decision-page/send`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId: j.docId }) })
        const sj = await sr.json().catch(() => ({}))
        alert(sr.ok && sj.sent ? `Approval letter emailed to ${sj.sent} board member(s) for signature.` : (sj?.note || 'Letter created. Use “Email the letter to the board” below to send the signing links.'))
      }
    } catch (e) { alert(`Could not create: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  const preview = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/decision-page?preview=1`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, conditions, leaseStart: isLease ? leaseStart : undefined, leaseEnd: isLease ? leaseEnd : undefined, occupants: occupants.split('\n').map(s => s.trim()).filter(Boolean), signers: pf?.defaultSigners.map(s => ({ name: s.name, email: s.email })) }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'preview failed')
      const url = URL.createObjectURL(await r.blob()); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { alert(`Could not preview: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 18, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#1f2a44' }}>Board Decision Page (approval letter)</div>
      <div style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 6px' }}>{pf?.propertyAddress ?? `Unit ${unit ?? '—'}`}</div>
      <div style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 10px' }}>Created and sent to the board automatically the instant every document is approved. Use the form below only to create a <strong>custom</strong> letter — different signers, or approval with conditions.</div>
      {pf && (
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 10 }}>
          Requires <strong>{pf.requiredSignatures}</strong> signature{pf.requiredSignatures === 1 ? '' : 's'} — sent to:
          {pf.defaultSigners.length === 0 && ' set board officers in Board Setup'}
          {pf.defaultSigners.map((sg, i) => (
            <span key={i} style={{ display: 'block', marginTop: 2 }}>
              • <strong>{sg.name}</strong>{sg.hasSignature ? ' ✍' : ''} — <span style={{ fontFamily: 'ui-monospace, monospace', color: sg.email ? '#2563eb' : '#b91c1c' }}>{sg.email || 'NO EMAIL ON FILE'}</span>
            </span>
          ))}
        </div>
      )}
      {/* A letter already out for signature — copy each signer's link any time
          (email can be filtered; this always works). Survives page reloads. */}
      {!result && pf?.pending && (
        <div style={{ margin: '0 0 12px', border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 10, padding: 12 }}>
          <div style={{ font: '700 12.5px system-ui', color: '#1e40af', marginBottom: 2 }}>
            📤 Letter out for signature — {pf.pending.signers.filter(s => s.signed).length}/{pf.pending.signers.length} signed · sent {fmt(pf.pending.createdAt)}
          </div>
          <div style={{ font: '12px system-ui', color: '#6b7280', marginBottom: 8 }}>Copy a signer&apos;s link and send it yourself if they didn&apos;t get the email. <a href={pf.pending.pdfUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>👁 View letter (PDF) →</a></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pf.pending.signers.map((sg, i) => <SignerRow key={i} sg={sg} />)}
          </div>
        </div>
      )}
      {!result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
          <select value={decision} onChange={e => setDecision(e.target.value)} style={{ ...inp, alignSelf: 'flex-start' }}><option>Approved</option><option>Approved with conditions</option><option>Declined</option></select>
          {isLease && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Lease term:</span>
              <input type="date" value={leaseStart} onChange={e => setLeaseStart(e.target.value)} style={inp} />
              <span style={{ color: '#9ca3af' }}>→</span>
              <input type="date" value={leaseEnd} onChange={e => setLeaseEnd(e.target.value)} style={inp} />
            </div>
          )}
          <label style={{ fontSize: 12, color: '#6b7280' }}>Approved occupants (one per line)</label>
          <textarea value={occupants} onChange={e => setOccupants(e.target.value)} style={{ ...inp, minHeight: 60, fontFamily: 'inherit' }} />
          {decision.includes('conditions') && <input placeholder="Conditions" value={conditions} onChange={e => setConditions(e.target.value)} style={inp} />}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={preview} disabled={busy} style={{ ...btn('#4338ca') }}>👁 Preview letter</button>
            <button onClick={create} disabled={busy} style={{ ...btn('#059669') }}>{busy ? 'Working…' : 'Create & send for signatures'}</button>
          </div>
          {/* Once the board has signed, (re)send the signed letter to every party. */}
          <button onClick={async () => {
            if (!confirm('Email the SIGNED approval letter (PDF attached) to all parties — applicant, owner, agents, board signers, on-site manager, PMI? Everyone is BCC\'d.')) return
            setBusy(true)
            try {
              const r = await fetch(`/api/admin/pre-apply/${id}/distribute-approval`, { method: 'POST', credentials: 'include' })
              const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
              alert(`Sent the signed approval letter to ${j.sent} recipient(s).`)
            } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
          }} disabled={busy} style={{ ...btn('#0f766e'), alignSelf: 'flex-start' }}>📤 Send signed letter to all parties</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, color: result.allSigned ? '#166534' : '#374151', marginBottom: 8 }}>
            {result.allSigned ? '✓ Fully signed. ' : `${result.signers.filter(s => s.signed).length}/${result.signers.length} signed. `}
            <a href={result.pdfUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>👁 View letter (PDF) →</a>
          </div>
          {!result.allSigned && result.docId && (
            <div style={{ marginBottom: 10 }}>
              <button onClick={async () => {
                setBusy(true)
                try {
                  const r = await fetch(`/api/admin/pre-apply/${id}/decision-page/send`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId: result.docId }) })
                  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
                  alert(j.sent > 0 ? `Emailed the signing link to ${j.sent} board member(s).` : (j.note ?? 'Nothing to send.'))
                } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setBusy(false) }
              }} disabled={busy} style={{ ...btn('#2563eb'), padding: '8px 14px' }}>{busy ? 'Sending…' : '✉ Email the letter to the board for signatures'}</button>
              <span style={{ font: '12px system-ui', color: '#9ca3af', marginLeft: 8 }}>or copy a link below</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.signers.map((sg, i) => <SignerRow key={i} sg={sg} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function SignerRow({ sg }: { sg: DecResult['signers'][number] }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      <span style={{ fontWeight: 600, minWidth: 150 }}>{sg.name || sg.email}</span>
      {sg.signed ? <span style={{ color: '#166534' }}>✓ signed (on file)</span> : (
        <>
          <input readOnly value={sg.link ?? ''} onFocus={e => e.currentTarget.select()} style={{ ...inp, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }} />
          <button onClick={async () => { await navigator.clipboard.writeText(sg.link ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1800) }} style={{ ...btn(copied ? '#059669' : '#f26a1b'), padding: '6px 12px' }}>{copied ? '✓' : 'Copy'}</button>
        </>
      )}
    </div>
  )
}

// One checklist row: the doc (if any) with an INLINE preview box, the suggested
// YYYY_MM_Type rename, an editable expiration date to approve, Ignore, and the
// upload/replace control.
function ChecklistRow({ id, c, doc, extraDocs, na, first, decided, onDone, driveFiles, driveFilesErr, loadDriveFiles, stakeholderId, applicants, checklist, assoc, appType, hasExample, review, scopeKey, onRequest }: { id: string; c: { doc_key: string; label: string; required: boolean; provided_by: string; allow_multiple?: boolean }; doc: Doc | undefined; extraDocs?: Doc[]; checklist?: { doc_key: string; label: string }[]; na: boolean; first: boolean; decided: boolean; onDone: () => void; driveFiles: { fileId: string; name: string; mimeType: string }[] | null; driveFilesErr?: string | null; loadDriveFiles: () => Promise<void>; stakeholderId?: string; applicants?: { id: string; name: string | null }[]; assoc?: string; appType?: string; hasExample?: boolean;
  review?: { state: 'waiting' | 'received' | 'approved' | 'refused'; decision: { by: string; role: string; at: string; reason: string | null } | null } | null;
  scopeKey?: string; onRequest?: (docKey: string, label: string) => void }) {
  const allowMultiple = !!c.allow_multiple
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [keepName, setKeepName] = useState(false)
  const [pagesFor, setPagesFor] = useState<Record<string, string>>({})
  const [assignErr, setAssignErr] = useState<string | null>(null)
  // Always refetch, not just on first open — driveFiles is shared across every
  // item's picker on this page, so once it loaded for ANY item it stayed
  // frozen for the rest of the session. A file placed in Drive after that
  // first fetch (staff's own report: "letter is in the drive but I don't have
  // the option to choose") never appeared no matter how many times the picker
  // was reopened.
  async function openPicker() { setPicking(true); setAssignErr(null); await loadDriveFiles() }
  async function assign(fileId: string, name: string, mimeType: string) {
    setBusy('assign'); setAssignErr(null)
    // Used to ignore the response entirely — a server-side error (bad page
    // range, a Drive read failure) closed the picker and called onDone() as
    // if it had worked, with nothing to show for it. User report, 2026-08-19:
    // "From Drive" felt "silent."
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/assign-drive`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: c.doc_key, doc_label: c.label, fileId, fileName: name, mimeType, pages: pagesFor[fileId] || '', keepName, stakeholder_id: stakeholderId, allow_multiple: allowMultiple }) })
      const j = await r.json().catch(() => ({}))
      // Some failures here (an unreadable page range, a Drive read error)
      // deliberately answer 200 with an error field rather than a non-OK
      // status — check both, not just r.ok.
      if (!r.ok || j.error) throw new Error(j.error || 'Could not assign this file.')
      setPicking(false); onDone()
    } catch (e) { setAssignErr((e as Error).message) } finally { setBusy(null) }
  }
  const [exp, setExp] = useState(doc?.expirationDate ?? '')
  const [savedExp, setSavedExp] = useState(doc?.expirationDate ?? '')
  const [noExp, setNoExp] = useState(!!doc?.noExpiration)
  const [busy, setBusy] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(doc?.suggestedName ?? doc?.filename ?? '')
  const [rescanMsg, setRescanMsg] = useState<{ tone: 'good' | 'bad' | 'plain'; text: string } | null>(null)
  useEffect(() => { setExp(doc?.expirationDate ?? ''); setSavedExp(doc?.expirationDate ?? ''); setNoExp(!!doc?.noExpiration); setNameVal(doc?.suggestedName ?? doc?.filename ?? ''); setRescanMsg(null) }, [doc?.id, doc?.expirationDate, doc?.noExpiration, doc?.suggestedName, doc?.filename])
  async function saveName() { setBusy('name'); try { await patchDoc({ suggested_name: nameVal }); setEditingName(false); onDone() } catch { /* */ } finally { setBusy(null) } }

  async function patchDoc(body: Record<string, unknown>) {
    await fetch(`/api/admin/pre-apply/${id}/doc/${doc!.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }
  async function saveExp() { setBusy('exp'); try { await patchDoc({ expiration_date: exp || null }); setSavedExp(exp) } catch { /* */ } finally { setBusy(null) } }
  async function toggleNoExp(v: boolean) { setNoExp(v); if (v) { setExp(''); setSavedExp('') } try { await patchDoc({ no_expiration: v }) } catch { /* */ } }
  // Re-read a document that's already stored. The scan on upload is best-effort
  // (a failed read must never lose the file), so a document can end up with a
  // blank expiration and no way back — this reads it again on demand.
  async function rescan() {
    setBusy('rescan'); setRescanMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/doc/${doc!.id}/rescan`, { method: 'POST', credentials: 'include' })
      const j = await r.json() as { error?: string; expiration?: string | null; foundExpiration?: boolean }
      if (!r.ok) { setRescanMsg({ tone: 'bad', text: j.error ?? 'Could not read this document.' }); return }
      if (j.foundExpiration && j.expiration) { setExp(j.expiration); setSavedExp(j.expiration); setRescanMsg({ tone: 'good', text: `✓ MAIA read this document — expires ${j.expiration}` }); onDone() }
      else setRescanMsg({ tone: 'plain', text: 'MAIA read this document and found no expiration date printed on it. Set one by hand, or tick “Does not expire”.' })
    } catch { setRescanMsg({ tone: 'bad', text: 'Could not reach MAIA — try again.' }) }
    finally { setBusy(null) }
  }
  async function ignore() {
    if (!confirm(`Remove "${c.label}" from this application? (The file stays in Drive.)`)) return
    setBusy('ignore')
    try { await fetch(`/api/admin/pre-apply/${id}/doc/${doc!.id}`, { method: 'DELETE', credentials: 'include' }); onDone() }
    catch { /* */ } finally { setBusy(null) }
  }
  const [combineErr, setCombineErr] = useState<string | null>(null)
  // Every separately-uploaded page of the same item (a tax return scanned as
  // a dozen JPEGs) merged into one PDF, in the order they were added. User
  // direction, 2026-08-19: "how can I make Maia append all of them?"
  async function combine() {
    if (!confirm(`Combine all ${(extraDocs?.length ?? 0) + 1} files for "${c.label}" into one PDF? The individual files are replaced by the combined one.`)) return
    setBusy('combine'); setCombineErr(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/doc/combine`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: c.doc_key, stakeholder_id: stakeholderId }) })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'Could not combine these files.')
      onDone()
    } catch (e) { setCombineErr((e as Error).message) } finally { setBusy(null) }
  }
  // Attach an EXAMPLE of this document, once, for the whole association. Every
  // future request email for this item then carries it automatically — the
  // answer to "please send me an example of this document you want".
  async function uploadExample(file: File) {
    if (!assoc || !appType) return
    setBusy('example')
    try {
      const body = { associationCode: assoc, applicationType: appType, docKey: c.doc_key }
      const u = await fetch('/api/admin/intake-documents/template', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, filename: file.name }) })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'failed')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload failed')
      const c2 = await fetch('/api/admin/intake-documents/template', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, path: uj.path }) })
      if (!c2.ok) throw new Error((await c2.json()).error || 'could not save')
      onDone()
    } catch (e) { alert(`Could not attach the example: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  async function toggleNa() {
    setBusy('na')
    try { await fetch(`/api/admin/pre-apply/${id}/na`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: c.doc_key, na: !na, stakeholder_id: stakeholderId }) }); onDone() }
    catch { /* */ } finally { setBusy(null) }
  }
  // Re-file a document onto a different checklist item — the content scan can
  // misread a page (three pages of one lease landing on three items), so staff
  // fix it after opening the file instead of deleting and re-uploading.
  async function refile(docId: string, nextKey: string) {
    const target = (checklist ?? []).find(x => x.doc_key === nextKey)
    if (!target) return
    setBusy('refile')
    try {
      await fetch(`/api/admin/pre-apply/${id}/doc/${docId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: target.doc_key, doc_label: target.label }) })
      onDone()
    } catch { /* */ } finally { setBusy(null) }
  }
  const RefileSelect = ({ docId, small }: { docId: string; small?: boolean }) => (checklist && checklist.length > 1) ? (
    <select value={c.doc_key} onChange={e => refile(docId, e.target.value)} disabled={busy === 'refile'} title="File this document under a different item"
      style={{ font: `600 ${small ? 10.5 : 11}px system-ui`, color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 6, padding: small ? '1px 3px' : '2px 4px', background: '#fff', cursor: 'pointer', maxWidth: small ? 150 : 190 }}>
      {checklist.map(x => <option key={x.doc_key} value={x.doc_key}>{x.doc_key === c.doc_key ? `↳ ${x.label}` : `Move to: ${x.label}`}</option>)}
    </select>
  ) : null

  // One Edit control opens the choices, instead of every option sitting on
  // every row. The flag on the right is the document's REVIEW state, not
  // "saved" — green means somebody read it and accepted it.
  const [editing, setEditing] = useState(false)
  const [refusing, setRefusing] = useState<string | null>(null)
  const rState = review?.state ?? (doc ? 'received' : 'waiting')
  const FLAG: Record<string, string> = { approved: '🟢', refused: '🔴', received: '🟠', waiting: '⚪' }

  async function decide(decision: 'approved' | 'refused' | 'clear') {
    if (!scopeKey) return
    if (decision === 'refused' && (refusing ?? '').trim().length < 4) {
      if (refusing === null) { setRefusing(''); return }
      alert('Say briefly why it is refused — the applicant sees this.')
      return
    }
    setBusy('decide')
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/review-decision`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scopeKey, decision, reason: refusing ?? '' }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'failed')
      setRefusing(null); onDone()
    } catch (e) { alert(`Could not save: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const isImg = (doc?.mime_type ?? '').startsWith('image/')
  const isExpired = !!(doc && doc.expirationDate && !doc.noExpiration && new Date(doc.expirationDate) < new Date())
  const link: React.CSSProperties = { font: '600 13px system-ui', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'none' }

  return (
    <div style={{ padding: '10px 14px', borderTop: first ? 'none' : '1px solid #f3f4f6', opacity: na ? 0.6 : 1, background: isExpired ? '#fef2f2' : undefined, borderLeft: isExpired ? '3px solid #b91c1c' : undefined }}>
      {/* The actions stay on the title line for EVERY row. The left column had
          no width limit, so one long "Will file as …" filename widened it far
          enough to wrap the whole action group onto a second line — which is
          why one row's buttons sat below its title while its neighbours' sat
          beside theirs. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span> <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px' }}>{c.provided_by}</span>{!c.required && <span style={{ fontSize: 11, color: '#6b7280' }}> · optional</span>}
          {isExpired && <span style={{ font: '700 10px system-ui', color: '#fff', background: '#b91c1c', borderRadius: 5, padding: '2px 7px', marginLeft: 7 }}>🚨 EXPIRED {new Date(doc!.expirationDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
          {doc && !na && (
            <div style={{ font: '11.5px system-ui', color: '#6b7280', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
              <span style={{ flexShrink: 0 }}>Will file as</span>
              {editingName ? (
                <>
                  <input value={nameVal} onChange={e => setNameVal(e.target.value)} style={{ font: '11.5px system-ui', padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 5, width: 210 }} />
                  <button onClick={saveName} disabled={busy === 'name'} style={{ font: '600 11px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}>Save</button>
                  <button onClick={() => { setEditingName(false); setNameVal(doc.suggestedName ?? doc.filename) }} style={{ ...link, color: '#9ca3af', fontSize: 11 }}>Cancel</button>
                </>
              ) : (
                <>
                  <strong title={doc.suggestedName || doc.filename} style={{ color: '#374151', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.suggestedName || doc.filename}</strong>
                  <button onClick={() => setEditingName(true)} style={{ ...link, color: '#2563eb', fontSize: 11, flexShrink: 0 }}>✎ rename</button>
                </>
              )}
              {doc.bySource === 'drive-scan' ? <span>· from Drive scan</span> : doc.bySource === 'esign' ? <span>· e-signed</span> : doc.bySource === 'drive-pick' ? <span>· picked from Drive</span> : null}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', flexShrink: 0 }}>
          {na ? <span style={{ font: '600 12px system-ui', color: '#6b7280', background: '#f3f4f6', borderRadius: 6, padding: '2px 8px' }}>N/A — not applicable</span> : (
            <>
              {doc && <button onClick={() => setOpen(o => !o)} style={{ ...link, color: '#4338ca' }}>{open ? 'Hide' : '👁 Preview'}</button>}
              {!decided && doc && (
                <>
                  <button onClick={() => decide(rState === 'approved' ? 'clear' : 'approved')} disabled={busy === 'decide'}
                    title={rState === 'approved' ? 'Undo this approval' : 'Approve this document'}
                    style={{ font: '600 12.5px system-ui', borderRadius: 7, padding: '5px 11px', cursor: 'pointer',
                      border: `1px solid ${rState === 'approved' ? '#0f7a4d' : '#d1d5db'}`,
                      background: rState === 'approved' ? '#0f7a4d' : '#fff', color: rState === 'approved' ? '#fff' : '#4a5265' }}>Approve</button>
                  <button onClick={() => decide('refused')} disabled={busy === 'decide'}
                    style={{ font: '600 12.5px system-ui', borderRadius: 7, padding: '5px 11px', cursor: 'pointer',
                      border: `1px solid ${rState === 'refused' ? '#b42318' : '#d1d5db'}`,
                      background: rState === 'refused' ? '#b42318' : '#fff', color: rState === 'refused' ? '#fff' : '#4a5265' }}>Refuse</button>
                </>
              )}
              {!decided && <button onClick={() => setEditing(e => !e)} aria-expanded={editing}
                style={{ font: '600 12.5px system-ui', borderRadius: 7, padding: '5px 11px', cursor: 'pointer',
                  border: '1px solid ' + (editing ? '#1f2a44' : '#d1d5db'), background: editing ? '#1f2a44' : '#fff', color: editing ? '#fff' : '#4a5265' }}>
                {editing ? '✕ Close' : '✎ Edit'}</button>}
              <span style={{ fontSize: 17, width: 20, textAlign: 'center' }} title={rState}>{FLAG[rState]}</span>
            </>
          )}
        </div>
      </div>

      {/* The decision, on the row, so nobody re-asks what the board objected to. */}
      {review?.decision && (
        <div style={{ font: '12.5px system-ui', color: '#4a5265', marginTop: 5 }}>
          {review.state === 'approved' ? '🟢' : '🔴'} <strong>{review.state === 'approved' ? 'Approved' : 'Refused'} by {review.decision.by}</strong>
          {' · '}<span style={{ color: '#9ca3af' }}>{fmt(review.decision.at)}</span>
          {review.decision.reason && <div style={{ marginTop: 3, borderLeft: '3px solid #b42318', paddingLeft: 8, color: '#16202f' }}>“{review.decision.reason}”</div>}
        </div>
      )}
      {refusing !== null && (
        <div style={{ marginTop: 7 }}>
          <textarea autoFocus value={refusing} onChange={e => setRefusing(e.target.value)}
            placeholder="Why is this refused? The applicant reads it — e.g. signed but not notarized."
            style={{ width: '100%', boxSizing: 'border-box', font: '13px system-ui', border: '1px solid #b42318', borderRadius: 7, padding: '7px 9px', minHeight: 46 }} />
          <div style={{ font: '11.5px system-ui', color: '#6b7280', marginTop: 3 }}>Press <b>Refuse</b> again to send it back · <button onClick={() => setRefusing(null)} style={{ ...link, color: '#6b7280', fontSize: 11.5 }}>cancel</button></div>
        </div>
      )}

      {editing && !na && (
        <div style={{ marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 9, background: '#f9fafb', padding: 11, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {doc && (
            <>
              <a href={doc.url ?? '#'} target="_blank" rel="noreferrer" style={{ ...link, color: '#166534' }}>View ↗</a>
              {!decided && applicants && applicants.length > 0 && (
                <select value={doc.stakeholderId ?? ''} onChange={async e => { setBusy('move'); try { await patchDoc({ stakeholder_id: e.target.value || null }); onDone() } catch { /* */ } finally { setBusy(null) } }} disabled={busy === 'move'} title="Move this document to another applicant" style={{ font: '600 11px system-ui', color: '#4338ca', border: '1px solid #d1d5db', borderRadius: 6, padding: '2px 4px', background: '#fff', cursor: 'pointer' }}>
                  {applicants.map(a => <option key={a.id} value={a.id}>{a.name || 'Applicant'}</option>)}
                  <option value="">Shared / none</option>
                </select>
              )}
              {!decided && doc && <RefileSelect docId={doc.id} />}
              {!decided && <button onClick={ignore} disabled={busy === 'ignore'} style={{ ...link, color: '#b91c1c' }}>Ignore</button>}
            </>
          )}
          {!na && <button onClick={openPicker} disabled={busy === 'assign'} style={{ ...link, color: '#2563eb', fontSize: 12 }}>{busy === 'assign' ? 'Assigning…' : '📁 From Drive'}</button>}
          {!na && <StaffUpload id={id} docKey={c.doc_key} docLabel={c.label} uploaded={!!doc} onDone={onDone} stakeholderId={stakeholderId} allowMultiple={allowMultiple} />}
          {assoc && appType && (
            <label style={{ ...link, color: hasExample ? '#166534' : '#9ca3af', fontSize: 12, cursor: 'pointer' }} title={hasExample ? 'An example is attached — every request email for this item includes it' : 'Attach an example so request emails can show one'}>
              {busy === 'example' ? 'Attaching…' : hasExample ? '📎 Example attached' : '📎 Add example'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadExample(f) }} />
            </label>
          )}
          {onRequest && <button onClick={() => onRequest(c.doc_key, c.label)} style={{ ...link, color: '#c2410c', fontSize: 12 }}>📨 Request it</button>}
          {!doc && <button onClick={toggleNa} disabled={busy === 'na'} style={{ ...link, color: '#9ca3af', fontSize: 12 }}>{na ? 'Undo N/A' : 'Mark N/A'}</button>}
          {na && <button onClick={toggleNa} disabled={busy === 'na'} style={{ ...link, color: '#4338ca', fontSize: 12 }}>Undo N/A</button>}
        </div>
      )}

      {/* Additional files for a multi-file item (e.g. the 2nd year's tax return). */}
      {extraDocs && extraDocs.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {extraDocs.map(ed => (
            <div key={ed.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#374151', background: '#f9fafb', border: '1px solid #eef0f3', borderRadius: 6, padding: '4px 8px' }}>
              <span>{ed.suggestedName || ed.filename}</span>
              <span style={{ display: 'flex', gap: 10 }}>
                <a href={ed.url ?? '#'} target="_blank" rel="noreferrer" style={{ font: '600 12px system-ui', color: '#166534', textDecoration: 'none' }}>View ↗</a>
                {!decided && <RefileSelect docId={ed.id} small />}
                {!decided && <button onClick={async () => { if (!confirm('Remove this file?')) return; await fetch(`/api/admin/pre-apply/${id}/doc/${ed.id}`, { method: 'DELETE', credentials: 'include' }); onDone() }} style={{ ...link, color: '#b91c1c', fontSize: 12 }}>Ignore</button>}
              </span>
            </div>
          ))}
          {!decided && (
            <div>
              <button onClick={combine} disabled={busy === 'combine'} style={{ ...link, color: '#5b21b6', fontSize: 12 }}>
                {busy === 'combine' ? 'Combining…' : `🔗 Combine these ${extraDocs.length + 1} files into one PDF`}
              </button>
              {combineErr && <div style={{ font: '11.5px system-ui', color: '#b91c1c', marginTop: 3 }}>⚠ {combineErr}</div>}
            </div>
          )}
        </div>
      )}

      {picking && (
        <div style={{ marginTop: 8, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ font: '600 12px system-ui', color: '#1e40af' }}>Pick a file for &quot;{c.label}&quot; — optionally pull just a page range (e.g. a W-2 inside a big report):</span>
            <span style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              <button onClick={loadDriveFiles} style={{ ...link, color: '#2563eb', fontSize: 12 }}>🔄 Refresh</button>
              <button onClick={() => setPicking(false)} style={{ ...link, color: '#6b7280', fontSize: 12 }}>Close</button>
            </span>
          </div>
          <label style={{ font: '12px system-ui', color: '#374151', display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={keepName} onChange={e => setKeepName(e.target.checked)} /> Keep the original file name (don&apos;t auto-rename)
          </label>
          {driveFilesErr && <div style={{ font: '12px system-ui', color: '#b91c1c', marginBottom: 6 }}>⚠ Could not read the Drive folder: {driveFilesErr}</div>}
          {assignErr && <div style={{ font: '12px system-ui', color: '#b91c1c', marginBottom: 6 }}>⚠ {assignErr}</div>}
          {!driveFiles ? <div style={{ font: '12px system-ui', color: '#6b7280' }}>Reading Drive folder…</div>
            : driveFiles.length === 0 ? <div style={{ font: '12px system-ui', color: '#9ca3af' }}>{driveFilesErr ? 'Could not list files — see the error above.' : 'No files in the Drive folder.'}</div>
            : <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {driveFiles.map(ff => {
                  const isPdf = ff.mimeType.includes('pdf')
                  return (
                    <div key={ff.fileId} style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 8px' }}>
                      <span style={{ font: '12.5px system-ui', color: '#374151', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isPdf ? '📄' : '🖼'} {ff.name}</span>
                      {isPdf && <input value={pagesFor[ff.fileId] ?? ''} onChange={e => setPagesFor(m => ({ ...m, [ff.fileId]: e.target.value }))} placeholder="pages e.g. 3-4" style={{ width: 96, font: '11.5px system-ui', padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 5 }} />}
                      <button onClick={() => assign(ff.fileId, ff.name, ff.mimeType)} disabled={busy === 'assign'} style={{ font: '600 11.5px system-ui', color: '#fff', background: '#2563eb', border: 'none', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{pagesFor[ff.fileId] ? 'Extract' : 'Assign'}</button>
                    </div>
                  )
                })}
              </div>}
        </div>
      )}

      {doc && !na && editing && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap', border: '1px solid #e5e7eb', borderRadius: 9, background: '#fff', padding: '9px 11px' }}>
          <span style={{ font: '600 12px system-ui', color: '#4a5265' }}>Expires:</span>
          <input type="date" value={exp} disabled={noExp} onChange={e => setExp(e.target.value)} style={{ font: '13px system-ui', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, opacity: noExp ? 0.5 : 1 }} />
          {!noExp && exp !== savedExp && <button onClick={saveExp} disabled={busy === 'exp'} style={{ font: '600 12px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>{busy === 'exp' ? 'Saving…' : 'Save'}</button>}
          {!noExp && exp === savedExp && savedExp && <span style={{ font: '12px system-ui', color: '#166534' }}>✓ saved</span>}
          <label style={{ font: '12px system-ui', color: '#374151', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginLeft: 6 }}>
            <input type="checkbox" checked={noExp} onChange={e => toggleNoExp(e.target.checked)} /> Does not expire (keep current)
          </label>
          {!decided && !noExp && (
            <button onClick={rescan} disabled={busy === 'rescan'} title="Have MAIA read the stored file again and pull the expiration date off it"
              style={{ font: '600 12px system-ui', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
              {busy === 'rescan' ? 'Reading…' : '🔍 Read expiration'}
            </button>
          )}
          {rescanMsg && <span style={{ font: '12px system-ui', color: rescanMsg.tone === 'good' ? '#166534' : rescanMsg.tone === 'bad' ? '#b91c1c' : '#6b7280', flexBasis: '100%' }}>{rescanMsg.text}</span>}
        </div>
      )}

      {open && doc && (
        <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#f9fafb' }}>
          {isImg
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={doc.url ?? ''} alt={c.label} style={{ display: 'block', maxWidth: '100%', margin: '0 auto' }} />
            : <iframe src={doc.url ?? ''} title={c.label} style={{ width: '100%', height: 480, border: 'none' }} />}
        </div>
      )}
    </div>
  )
}

// Read the files already in the linked Drive folder, classify each, and import
// them into the matching checklist items (non-destructive — nothing in Drive
// changes). One click; the checklist fills in with what it finds.
function ScanDrive({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ scanned: number; matched: { file: string; item: string; rename?: string; expiration?: string | null }[]; unmatched: { file: string; docType: string | null }[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function scan() {
    setBusy(true); setErr(null); setRes(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/scan-drive`, { method: 'POST', credentials: 'include' })
      const text = await r.text()
      let j: { error?: string; scanned?: number; matched?: { file: string; item: string; rename?: string; expiration?: string | null }[]; unmatched?: { file: string; docType: string | null }[] }
      try { j = JSON.parse(text) } catch { throw new Error(r.ok ? 'The scan response was not readable — please try again.' : `Scan failed (${r.status}) — it may have timed out. Try again, or upload manually.`) }
      if (!r.ok || j.error) throw new Error(j.error || 'failed')
      setRes(j as { scanned: number; matched: { file: string; item: string; rename?: string; expiration?: string | null }[]; unmatched: { file: string; docType: string | null }[] }); onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ margin: '0 0 12px' }}>
      <button onClick={scan} disabled={busy} style={{ font: '600 13px system-ui', color: '#fff', background: busy ? '#9ca3af' : '#4338ca', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Reading & scanning Drive files…' : '🔎 Scan Drive folder & save to MAIA'}
      </button>
      {err && <p style={{ color: '#b91c1c', font: '13px system-ui', margin: '8px 0 0' }}>⚠ {err}</p>}
      {res && (
        <div style={{ marginTop: 8, font: '12.5px system-ui', color: '#374151' }}>
          <div style={{ color: '#166534', fontWeight: 600 }}>✓ Saved to MAIA — scanned {res.scanned} file(s), imported {res.matched.length} to the checklist. Review each below — preview, set/confirm the expiration, mark &quot;does not expire&quot;, or Ignore.</div>
          {res.matched.map((m, i) => <div key={i} style={{ color: '#374151' }}>• <span style={{ color: '#9ca3af' }}>{m.file}</span> → <strong>{m.item}</strong>{m.rename ? <span style={{ color: '#9ca3af' }}> · files as {m.rename}</span> : ''}{m.expiration ? <span style={{ color: '#b45309' }}> · expires {m.expiration}</span> : ''}</div>)}
          {res.unmatched.length > 0 && <div style={{ color: '#92400e', marginTop: 4 }}>Not matched to a checklist item ({res.unmatched.length}): {res.unmatched.map(u => u.docType || u.file).join(', ')} — upload these manually if needed.</div>}
        </div>
      )}
    </div>
  )
}

// Staff upload-on-behalf for one checklist item → files it against the
// application AND mirrors it to the unit's On Going Applications Drive folder.
function StaffUpload({ id, docKey, docLabel, uploaded, onDone, stakeholderId, allowMultiple }: { id: string; docKey: string; docLabel: string; uploaded: boolean; onDone: () => void; stakeholderId?: string; allowMultiple?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // "add" appends another file to the SAME item — a lease split across three
  // scans, a policy with its declarations page — instead of replacing.
  const [mode, setMode] = useState<'replace' | 'add'>('replace')
  const inputId = `up-${docKey}-${stakeholderId ?? 'shared'}`
  const addId = `add-${docKey}-${stakeholderId ?? 'shared'}`

  async function onFile(file: File | null) {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      // Signed-URL upload — straight from the browser to Storage, not through
      // this Vercel function — so a large signed lease or purchase agreement
      // never hits the platform's request-body limit. See upload-url/route.ts.
      const u = await fetch(`/api/admin/pre-apply/${id}/upload-url`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: docKey, filename: file.name }) })
      const uj = await u.json(); if (!u.ok) throw new Error(uj.error || 'could not start upload')
      const put = await fetch(uj.signedUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } })
      if (!put.ok) throw new Error('upload to storage failed')
      const r = await fetch(`/api/admin/pre-apply/${id}/upload`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          doc_key: docKey, doc_label: docLabel, storage_path: uj.path, filename: file.name, mime_type: file.type,
          stakeholder_id: stakeholderId || undefined, allow_multiple: allowMultiple || mode === 'add' || undefined,
        }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'upload failed')
      if (j?.drive && !j.drive.ok) setMsg(`Filed · Drive copy pending: ${j.drive.error}`)
      onDone()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input id={inputId} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={e => { setMode('replace'); onFile(e.target.files?.[0] ?? null) }} />
      <label htmlFor={inputId} style={{ cursor: busy ? 'default' : 'pointer', font: '600 12px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#f26a1b', borderRadius: 7, padding: '5px 10px' }}>
        {busy ? 'Uploading…' : allowMultiple ? '+ Add file' : uploaded ? 'Replace' : 'Upload'}
      </label>
      {/* Once something is on file, allow MORE files on the same item — a lease
          scanned as three separate pages belongs together, not as a replacement. */}
      {uploaded && !allowMultiple && (
        <>
          <input id={addId} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={e => { setMode('add'); onFile(e.target.files?.[0] ?? null) }} />
          <label htmlFor={addId} title="Add another file/page to this same item" style={{ cursor: busy ? 'default' : 'pointer', font: '600 12px system-ui', color: '#0f766e', background: '#fff', border: '1px solid #99f6e4', borderRadius: 7, padding: '4px 9px' }}>+ Add page</label>
        </>
      )}
      {msg && <span style={{ font: '11px system-ui', color: '#b45309', maxWidth: 200 }}>{msg}</span>}
    </span>
  )
}

// Board approval engine: dry-run preview (scan + classify) → confirm → execute
// (copy keepers to Official, move the folder to Archive, mark approved).
interface ApprovePlan { toOfficial: { from: string; as: string; docType: string | null }[]; toArchiveOnly: { name: string; docType: string | null }[]; archiveInto: string; totalFiles: number }
function BoardApprove({ id, onDone }: { id: string; onDone: () => void }) {
  const [plan, setPlan] = useState<ApprovePlan | null>(null)
  const [busy, setBusy] = useState<'plan' | 'run' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ copiedToOfficial: number; movedToArchive: number; errors: string[] } | null>(null)

  async function preview() {
    setBusy('plan'); setErr(null); setResult(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/board-approve`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); setPlan(j)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  async function execute() {
    if (!confirm('This copies the keeper files into the unit’s Official folder and MOVES the whole application folder into OLD/Archive. Continue?')) return
    setBusy('run'); setErr(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/board-approve`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: false }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); setResult(j); setPlan(null); onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div style={{ marginTop: 18, border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 12, padding: 16 }}>
      <div style={{ font: '700 15px system-ui', color: '#166534' }}>🏛 Filing to Official &amp; Archive</div>
      <div style={{ font: '400 13px system-ui', color: '#3f6212', margin: '4px 0 12px' }}>Happens automatically the instant every signer has signed the approval letter below — MAIA copies the <strong>documents you saved above</strong> (the keepers — Lease, HO-6, Certificate of Use, Board Approval, Decision Page, Affidavit, Agreement) into the unit’s <strong>Official</strong> folder using their approved names, then moves the whole application folder into <strong>OLD/Archive</strong> and marks the application approved. This panel is a preview, or a manual re-run if the automatic filing needs a retry — it still requires a fully-signed letter before it will actually file anything.</div>
      {err && <p style={{ color: '#b91c1c', font: '13px system-ui' }}>⚠ {err}</p>}
      {result ? (
        <p style={{ font: '600 13px system-ui', color: '#166534' }}>✓ Done — {result.copiedToOfficial} copied to Official · {result.movedToArchive} moved to Archive{result.errors.length ? ` · ${result.errors.length} issue(s): ${result.errors.join('; ')}` : ''}</p>
      ) : plan ? (
        <div style={{ background: '#fff', border: '1px solid #d1fae5', borderRadius: 10, padding: 12 }}>
          <div style={{ font: '700 12px system-ui', color: '#166534', textTransform: 'uppercase', letterSpacing: '.04em' }}>Copy to Official ({plan.toOfficial.length})</div>
          {plan.toOfficial.length ? plan.toOfficial.map((k, i) => (
            <div key={i} style={{ font: '13px system-ui', color: '#374151', margin: '2px 0' }}>✓ <span style={{ color: '#9ca3af' }}>{k.from}</span> → <strong>{k.as}</strong>{k.docType ? <span style={{ color: '#9ca3af' }}> · {k.docType}</span> : ''}</div>
          )) : <div style={{ font: '13px system-ui', color: '#9ca3af' }}>No keeper documents found.</div>}
          <div style={{ font: '700 12px system-ui', color: '#92400e', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 10 }}>Move all {plan.totalFiles} file(s) → {plan.archiveInto}</div>
          {plan.toArchiveOnly.length > 0 && <div style={{ font: '12px system-ui', color: '#6b7280', marginTop: 2 }}>Archive-only (not copied to Official): {plan.toArchiveOnly.map(a => a.docType || a.name).join(', ')}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={execute} disabled={busy === 'run'} style={btn('#166534')}>{busy === 'run' ? 'Filing…' : 'Confirm & execute →'}</button>
            <button onClick={() => setPlan(null)} style={{ ...btn('#e5e7eb'), color: '#374151' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={preview} disabled={busy === 'plan'} style={btn('#166534')}>{busy === 'plan' ? 'Scanning files…' : '👁 Preview the Official/Archive filing'}</button>
      )}
    </div>
  )
}

// Set the applicant name + the application type (new lease / lease renewal /
// purchase / additional occupant). Imported/Drive-only apps have no applicant
// name, so it shows "—" until set here.
const APP_TYPES: { key: string; label: string }[] = [
  { key: 'lease', label: 'New lease' }, { key: 'lease_renewal', label: 'Lease renewal' },
  { key: 'purchase', label: 'Purchase' }, { key: 'additional_occupant', label: 'Additional occupant' },
]
function MetaEditor({ id, name, others = [], type, onDone }: { id: string; name: string; others?: string[]; type: string; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [nameV, setNameV] = useState(name)
  const [typeV, setTypeV] = useState(type)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setNameV(name); setTypeV(type) }, [name, type])
  async function save() {
    setBusy(true)
    try {
      // An approved application is the record of who the board approved, so the
      // server asks for an explicit confirmation before it is rewritten rather
      // than refusing outright — refusing meant re-filing from scratch and
      // losing the uploaded documents and the signed approval letter.
      const post = (confirmApproved?: boolean) => fetch(`/api/admin/pre-apply/${id}/meta`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicant_name: nameV, application_type: typeV, ...(confirmApproved ? { confirmApproved: true } : {}) }) })
      let r = await post()
      if (r.status === 409) {
        const j409 = await r.clone().json().catch(() => ({}))
        if (j409?.needsConfirm && confirm(`${j409.error}\n\nRewrite the approved record?`)) r = await post(true)
      }
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'failed')
      // Documents imported under the previous type that this type doesn't need.
      if (Array.isArray(j.staleDocs) && j.staleDocs.length) {
        alert(`Saved.\n\nThese documents were imported under the previous type and are NOT required for ${APP_TYPES.find(t => t.key === typeV)?.label ?? typeV}:\n\n• ${j.staleDocs.join('\n• ')}\n\nThey'll show as "not required for this application type" and won't raise alarms. Use Ignore on a row to remove it (the file stays in Drive).`)
      }
      setEditing(false); onDone()
    }
    catch (e) { alert(`Could not save: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  if (!editing) return (
    <p style={{ fontSize: 13, color: '#374151', margin: '6px 0 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        <strong>Applicant{others.length ? 's' : ''}:</strong> {name || <span style={{ color: '#b45309' }}>not set</span>}
        {others.length > 0 && <span> &amp; {others.join(' & ')}</span>}
      </span>
      <span style={{ color: '#9ca3af' }}>·</span>
      <span><strong>Type:</strong> {APP_TYPES.find(t => t.key === type)?.label ?? type}</span>
      <button onClick={() => setEditing(true)} style={{ font: '600 12px system-ui', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>✎ edit</button>
    </p>
  )
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 0', flexWrap: 'wrap', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px' }}>
      <input value={nameV} onChange={e => setNameV(e.target.value)} placeholder="Applicant name" style={{ font: '13px system-ui', padding: '5px 9px', border: '1px solid #d1d5db', borderRadius: 6, width: 200 }} />
      <select value={typeV} onChange={e => setTypeV(e.target.value)} style={{ font: '13px system-ui', padding: '5px 9px', border: '1px solid #d1d5db', borderRadius: 6 }}>
        {APP_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
      <button onClick={save} disabled={busy} style={{ font: '600 12px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save'}</button>
      <button onClick={() => { setEditing(false); setNameV(name); setTypeV(type) }} style={{ font: '600 12px system-ui', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
    </div>
  )
}

// The applicant roster — read the names off the lease, confirm/add/remove, save.
// This is what lets MAIA collect each applicant's documents in their own column.
// Lease renewal / additional occupant: pull the previous approved term's keeper
// files into this application (independent copies; the approval letter isn't
// carried — a new one is issued).
function CarryOverButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function run() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/carry-over`, { method: 'POST', credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(j.count > 0 ? `✓ Brought in ${j.count} file(s) from the previous approved term.` : 'No previous approved application on file for this unit — use “From Drive” on each item to pull the prior files from the folder.')
      onDone()
    } catch (e) { setMsg(`Could not bring in files: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  return (
    <div style={{ margin: '0 0 10px' }}>
      <button onClick={run} disabled={busy} style={{ ...btn('#0f766e'), padding: '8px 14px' }}>{busy ? 'Bringing in…' : '📥 Bring in the previous term’s files'}</button>
      {msg && <p style={{ font: '12.5px system-ui', color: '#6b7280', margin: '6px 0 0' }}>{msg}</p>}
    </div>
  )
}

// Per-applicant credit score — the headline number from their background check
// (Tenant Evaluation for now). Shown to the board; the report image is the
// Background / Credit Reports document below.
function CreditScore({ id, stakeholderId, name, score, decided, onDone }: { id: string; stakeholderId: string; name: string | null; score: number | null; decided: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(score != null ? String(score) : '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVal(score != null ? String(score) : '') }, [score])
  const band = score == null ? null : score >= 740 ? { t: 'Excellent', c: '#166534' } : score >= 670 ? { t: 'Good', c: '#166534' } : score >= 580 ? { t: 'Fair', c: '#b45309' } : { t: 'Poor', c: '#b91c1c' }
  async function save() {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/applicant-score`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stakeholder_id: stakeholderId, credit_score: val.trim() || null }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed'); setEditing(false); onDone()
    } catch (e) { alert(`Could not save: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', margin: '0 0 4px', background: '#f9fafb', border: '1px solid #eef0f3', borderRadius: 8, flexWrap: 'wrap' }}>
      <span style={{ font: '700 11px system-ui', letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280' }}>Credit score</span>
      {editing ? (
        <>
          <input value={val} onChange={e => setVal(e.target.value.replace(/[^\d]/g, ''))} placeholder="300–850" style={{ font: '700 15px system-ui', width: 90, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6 }} />
          <button onClick={save} disabled={busy} style={{ font: '600 12px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save'}</button>
          <button onClick={() => { setEditing(false); setVal(score != null ? String(score) : '') }} style={{ font: '600 12px system-ui', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
        </>
      ) : score != null && band ? (
        <>
          <span style={{ font: '800 17px system-ui', color: '#fff', background: band.c, borderRadius: 8, padding: '3px 12px' }}>{score}</span>
          <span style={{ font: '600 12.5px system-ui', color: band.c }}>{band.t}</span>
          {!decided && <button onClick={() => setEditing(true)} style={{ font: '600 12px system-ui', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>✎ edit</button>}
        </>
      ) : (
        <>
          <span style={{ font: '13px system-ui', color: '#9ca3af' }}>Not entered{name ? ` for ${name}` : ''}</span>
          {!decided && <button onClick={() => setEditing(true)} style={{ font: '600 12px system-ui', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add from background check</button>}
        </>
      )}
    </div>
  )
}

// Request specific documents from the owner and/or tenant — tick items, tag each
// Owner / Tenant / Both, and MAIA emails each recipient their list + an upload
// link (the standard PMI email). Uploads file straight back onto the application.
function RequestDocs({ id, items, ownerName, ownerEmails, tenantEmail, listingAgent, applicantAgent, onDone, preselect, onPreselectHandled }: { id: string; items: { doc_key: string; label: string; provided_by: string; missing: boolean; refused: boolean }[]; ownerName: string | null; ownerEmails: string | null; tenantEmail: string | null; listingAgent?: { name: string | null; email: string | null } | null; applicantAgent?: { name: string | null; email: string | null } | null; onDone: () => void; preselect?: { doc_key: string; label: string } | null; onPreselectHandled?: () => void }) {
  const [open, setOpen] = useState(false)
  type Rec = 'owner' | 'tenant' | 'both'
  const [state, setState] = useState<Record<string, { on: boolean; rec: Rec }>>(() =>
    // 'both' is a real answer on the checklist, not just an ad-hoc choice at
    // send time — renter's insurance can come from either the tenant or the
    // owner, so it defaults to asking both rather than guessing one.
    Object.fromEntries(items.map(it => [it.doc_key, { on: it.missing, rec: (it.provided_by === 'both' ? 'both' : it.provided_by === 'landlord' ? 'owner' : 'tenant') as Rec }])))
  // `state` only seeds from `items` once, on mount — but this panel stays
  // mounted (just hidden) while the rest of the page keeps reloading live
  // review data, so approving/refusing a document elsewhere on the page
  // never re-synced its checkbox here. Real case, unit 613: staff approved
  // Car Registration in the main checklist and it still showed ticked +
  // "missing" in this panel. Only auto-follow a row the user hasn't touched
  // by hand since the last sync (checkbox still matches the old missing
  // value) so a manual tick/untick is never silently overridden.
  const missingRef = useRef<Record<string, boolean>>(Object.fromEntries(items.map(it => [it.doc_key, it.missing])))
  useEffect(() => {
    setState(st => {
      let changed = false
      const next = { ...st }
      for (const it of items) {
        const rec = (it.provided_by === 'both' ? 'both' : it.provided_by === 'landlord' ? 'owner' : 'tenant') as Rec
        const cur = next[it.doc_key]
        if (!cur) { next[it.doc_key] = { on: it.missing, rec }; changed = true; continue }
        const prevMissing = missingRef.current[it.doc_key]
        if (prevMissing !== undefined && prevMissing !== it.missing && cur.on === prevMissing) {
          next[it.doc_key] = { ...cur, on: it.missing }
          changed = true
        }
      }
      missingRef.current = Object.fromEntries(items.map(it => [it.doc_key, it.missing]))
      return changed ? next : st
    })
  }, [items])
  const [msg, setMsg] = useState('')
  const [ownerTo, setOwnerTo] = useState(ownerEmails ?? '')
  // Seeded once, so an owner address that arrives (or is corrected) after the
  // first render left this box empty — which is how a request went out with no
  // owner recipient at all.
  const ownerSeed = useRef(ownerEmails ?? '')
  useEffect(() => {
    const next = ownerEmails ?? ''
    if (ownerSeed.current === next) return
    ownerSeed.current = next
    setOwnerTo(cur => cur.trim() ? cur : next)
  }, [ownerEmails])
  const [tenantTo, setTenantTo] = useState(tenantEmail ?? '')
  // Same staleness the ownerTo effect above already fixes, just never applied
  // here — a tenant email that arrives after the panel's first render (e.g.
  // staff adds the applicant's email in the Applicants card while this panel
  // is already open) left this box empty, looking like it was never saved.
  // User report, 2026-08-19: "the second card is missing the tenant info as
  // not saved" — it WAS saved; this box just never re-read it.
  const tenantSeed = useRef(tenantEmail ?? '')
  useEffect(() => {
    const next = tenantEmail ?? ''
    if (tenantSeed.current === next) return
    tenantSeed.current = next
    setTenantTo(cur => cur.trim() ? cur : next)
  }, [tenantEmail])
  const [busy, setBusy] = useState(false)

  // "Request it" on a document row brings you here with that item ticked, so
  // the only choice left is who it goes to.
  //
  // It used to REPLACE the whole selection every time, which meant clicking
  // "Request it" on three rows left only the third ticked, and any boxes ticked
  // by hand were silently cleared. So: opening the panel from a row narrows to
  // that row (you asked for that one), but once the panel is already open every
  // further "Request it" ADDS to what is ticked.
  useEffect(() => {
    if (!preselect) return
    const wasOpen = open
    setOpen(true)
    setState(st => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, {
      ...v,
      // '__outstanding__' means "everything still owed" — the default ticks
      // already reflect what is missing, so leave them alone in that case.
      on: preselect.doc_key === '__outstanding__' ? v.on
        : wasOpen ? (v.on || k === preselect.doc_key)
        : k === preselect.doc_key,
    }])))
    // The panel now sits below both document lists, so a click from a row up
    // the page has to bring it into view.
    requestAnimationFrame(() => document.getElementById('request-docs-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    onPreselectHandled?.()
  // `open` is read to decide narrow-vs-add; it must not re-run this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, onPreselectHandled])
  const selected = items.filter(it => state[it.doc_key]?.on)
  const needOwner = selected.some(it => state[it.doc_key].rec === 'owner' || state[it.doc_key].rec === 'both')
  const needTenant = selected.some(it => state[it.doc_key].rec === 'tenant' || state[it.doc_key].rec === 'both')

  // Asking the owner for the roster is what UNBLOCKS a missing tenant address —
  // so it must never be blocked BY one. When it's ticked, tenant items ride
  // along and go out on their own the moment the owner sends the names back.
  const askingRoster = selected.some(it => it.doc_key === 'tenant_contact_info' && (state[it.doc_key].rec === 'owner' || state[it.doc_key].rec === 'both'))

  async function send() {
    if (needOwner && !ownerTo.includes('@')) { alert('Enter an owner email (verify it — the owners record can carry several).'); return }
    if (needTenant && !tenantTo.includes('@') && !askingRoster) {
      alert('There is no applicant email on file.\n\nTick the roster item and send it to the owner — MAIA will email the applicant their items automatically as soon as the owner fills the list in.')
      return
    }
    setBusy(true)
    try {
      const payload = selected.map(it => ({ doc_key: it.doc_key, label: it.label, recipient: state[it.doc_key].rec }))
      const r = await fetch(`/api/admin/pre-apply/${id}/request-docs`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: payload, message: msg, ownerEmail: ownerTo, tenantEmail: tenantTo }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      const parts: string[] = []
      if (j.sentOwner) parts.push(`owner (${j.ownerEmail})`)
      if (j.sentTenant) parts.push(`applicant (${j.tenantEmail})`)
      const held = j.tenantHeld ? '\n\nThe applicant’s items are waiting on their contact details — MAIA emails them automatically as soon as the owner fills in the list.' : ''
      // Forms MAIA generates went to the person who signs them, not through
      // the upload link — say so, or it looks like nothing happened.
      const forms = (j.formsSent ?? []) as { noun: string; name: string | null; email: string }[]
      const formLine = forms.length
        ? `\n\nSent for signature:\n${forms.map(f => `  · ${f.noun} → ${f.name ?? f.email}`).join('\n')}`
        : ''
      const packetSent = (j.packetSent ?? []) as string[]
      const packetLine = packetSent.length ? `\n\nLandlord–Tenant Agreement — sent to sign:\n${packetSent.map(s => `  · ${s}`).join('\n')}` : ''
      const uploadLine = parts.length ? `Sent the request + upload link to ${parts.join(' and ')}.` : ''
      const summary = `${uploadLine}${formLine}${packetLine}${held}${j.warnings?.length ? '\n\n' + j.warnings.join('\n') : ''}`.trim()
      alert(summary || 'Nothing was sent.')
      setOpen(false); onDone()
    } catch (e) { alert(`Could not send: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const seg = (dk: string, r: Rec, label: string) => (
    <button onClick={() => setState(s => ({ ...s, [dk]: { ...s[dk], rec: r } }))} style={{ font: '700 12px system-ui', padding: '4px 11px', border: 'none', borderLeft: '1px solid #d1d5db', background: state[dk]?.rec === r ? '#c05a1c' : '#fff', color: state[dk]?.rec === r ? '#fff' : '#6b7280', cursor: 'pointer' }}>{label}</button>
  )

  if (!open) return (
    <div style={{ margin: '0 0 12px' }}>
      <button onClick={() => setOpen(true)} style={{ ...btn('#c05a1c'), padding: '8px 14px' }}>📩 Request documents from owner / applicant</button>
    </div>
  )
  return (
    <div id="request-docs-panel" style={{ margin: '0 0 12px', border: '1px solid #c05a1c', borderRadius: 12, background: '#fff', padding: 14, boxShadow: '0 0 0 1px #c05a1c22' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ font: '700 14px system-ui', color: '#1f2937' }}>📩 Request the missing documents</span>
        <button onClick={() => setOpen(false)} style={{ font: '600 12px system-ui', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
      </div>
      <p style={{ font: '12.5px system-ui', color: '#6b7280', margin: '0 0 10px' }}>Tick what to ask for and who provides it. Each recipient gets one email with their items + a secure upload link (no login).</p>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        {/* Every row is ONE line of the same height. A long label — "Tenant
            Affidavit (signed & notarized by tenant and landlord) — one per
            occupant" — used to wrap onto a second line, making that row taller
            than its neighbours and knocking the Owner/Tenant/Both controls out
            of their column. The label truncates with the full text on hover
            instead; the controls never shrink. */}
        {items.map((it, i) => {
          // provided_by === 'staff' means nobody EXTERNAL is ever asked — the
          // Background / Credit Reports lesson: it comes from Tenant
          // Evaluation or Checkr, staff obtains and uploads it directly.
          // There is no recipient to pick, so there is no checkbox either —
          // ticking it and sending would have asked a resident for something
          // they cannot produce.
          const staffOnly = it.provided_by === 'staff'
          return (
          <div key={it.doc_key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', height: 42, borderTop: i ? '1px solid #f3f4f6' : 'none', opacity: staffOnly ? 0.7 : 1 }}>
            <input type="checkbox" disabled={staffOnly} checked={!staffOnly && !!state[it.doc_key]?.on} onChange={e => setState(s => ({ ...s, [it.doc_key]: { ...s[it.doc_key], on: e.target.checked } }))} style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span title={it.label} style={{ flex: 1, minWidth: 0, font: '600 13.5px system-ui', color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {it.label}{it.refused && <span style={{ font: '600 11px system-ui', color: '#b42318', marginLeft: 6 }}>refused</span>}{it.missing && !it.refused && <span style={{ font: '600 11px system-ui', color: '#b45309', marginLeft: 6 }}>missing</span>}
            </span>
            {/* A form MAIA generates has no "who uploads it" — it goes to the
                person who signs it. Showing the Owner/Tenant/Both control here
                offered a choice that never had any effect. */}
            {staffOnly
              ? <span style={{ font: '600 11px system-ui', color: '#6b7280', background: '#f3f4f6', borderRadius: 7, padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>🗂️ Staff obtains this</span>
              : ESIGN_ITEM_KEYS.has(it.doc_key)
              ? <span style={{ font: '600 11px system-ui', color: '#5b21b6', background: '#f3e8ff', borderRadius: 7, padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>✍️ MAIA sends it to sign</span>
              // "Applicant" not "Tenant" — this control is shared by every
              // application type, and "Tenant" is simply wrong on a Purchase
              // (there's a buyer, not a tenant). User report, 2026-08-19:
              // "when is a purchase the list is still coming as tenant,
              // should be buyer or change to a fix name as Applicant."
              : <span style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>{seg(it.doc_key, 'owner', 'Owner')}{seg(it.doc_key, 'tenant', 'Applicant')}{seg(it.doc_key, 'both', 'Both')}</span>}
          </div>
          )
        })}
      </div>
      {/* Confirm the recipients — the owners record can carry several / wrong emails, so verify before sending. */}
      {(needOwner || needTenant) && (
        <div style={{ marginTop: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10 }}>
          <div style={{ font: '600 11.5px system-ui', color: '#92400e', marginBottom: 6 }}>⚠ Verify who this goes to — remove any wrong address (owner records can mix several contacts). Separate multiple with commas.</div>
          {needOwner && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ font: '600 11px system-ui', color: '#6b7280', width: 96 }}>Owner{ownerName ? ` (${ownerName})` : ''}</span>
                <input value={ownerTo} onChange={e => setOwnerTo(e.target.value)} placeholder="owner@example.com" style={{ flex: '1 1 240px', minWidth: 200, font: '13px system-ui', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6 }} />
              </div>
              {/* There's no separate "Agent" recipient to pick — an item asked
                  of the Owner already CCs the listing agent on the SAME email
                  (lib/document-request-email.ts), so this is the only place
                  staff can see he'll get it at all. User question, 2026-08-19:
                  "I don't have the option or I don't see if he will receive
                  the email." */}
              {listingAgent?.email && (
                <div style={{ font: '11.5px system-ui', color: '#1e40af', marginTop: 4, marginLeft: 104 }}>🔗 CC&apos;d: {listingAgent.name ? `${listingAgent.name} (listing agent)` : 'listing agent'} — {listingAgent.email}</div>
              )}
            </div>
          )}
          {needTenant && (
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ font: '600 11px system-ui', color: '#6b7280', width: 96 }}>Applicant</span>
                <input value={tenantTo} onChange={e => setTenantTo(e.target.value)} placeholder={askingRoster ? 'leave blank — the owner is being asked for this' : 'applicant@example.com'} style={{ flex: '1 1 240px', minWidth: 200, font: '13px system-ui', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6 }} />
              </div>
              {applicantAgent?.email && (
                <div style={{ font: '11.5px system-ui', color: '#1e40af', marginTop: 4, marginLeft: 104 }}>🔗 CC&apos;d: {applicantAgent.name ? `${applicantAgent.name} (applicant's agent)` : "applicant's agent"} — {applicantAgent.email}</div>
              )}
            </div>
          )}
          {needTenant && !tenantTo.includes('@') && askingRoster && (
            <div style={{ font: '11.5px system-ui', color: '#166534', marginTop: 6 }}>✓ No applicant address needed right now — the owner is being asked for the names, emails and phones, and MAIA emails the applicants their items automatically once that comes back.</div>
          )}
        </div>
      )}
      <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Add a note to include in the email (optional)…" style={{ width: '100%', boxSizing: 'border-box', marginTop: 10, minHeight: 48, padding: 9, border: '1px solid #d1d5db', borderRadius: 8, font: '13px system-ui' }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={send} disabled={busy || selected.length === 0} style={{ ...btn(selected.length ? '#c05a1c' : '#c9ccd3'), padding: '8px 14px' }}>{busy ? 'Sending…' : `✉ Send request + upload link (${selected.length})`}</button>
      </div>
    </div>
  )
}

// Re-send a request that already went out. The email is rebuilt from the
// CURRENT checklist, so attaching an example and pressing this is how an owner
// who asked "send me an example of this document" gets one — without a second,
// differently-worded request confusing them. The upload tokens don't change,
// so any link they already have keeps working.
function ResendRequest({ id, requestId }: { id: string; requestId: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function resend() {
    if (!confirm('Re-send this request? The recipients get the same list again, now including any examples you have attached since.')) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/request-docs/${requestId}/resend`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(`Re-sent${j.sentOwner ? ' to the owner' : ''}${j.sentOwner && j.sentTenant ? ' and' : ''}${j.sentTenant ? ' to the tenant' : ''}.`)
    } catch (e) { setMsg(`Could not re-send: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={resend} disabled={busy} style={{ background: 'none', border: 'none', padding: 0, cursor: busy ? 'default' : 'pointer', font: '600 12px system-ui', color: '#2563eb' }}>
        {busy ? 'Re-sending…' : '📨 Re-send (includes any examples attached since)'}
      </button>
      {msg && <div style={{ font: '12px system-ui', color: msg.startsWith('Re-sent') ? '#166534' : '#b91c1c', marginTop: 3 }}>{msg}</div>}
    </div>
  )
}

// Send the per-document list to the board + on-site manager. Any one of them
// settles a document; PMI and Jonathan are told each time somebody responds.
function BoardReviewSender({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/board-review`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setMsg(j.sent ? `Sent to ${(j.to ?? []).join(', ')}` : 'Created — copy the link and send it by hand.')
      onDone()
    } catch (e) { setMsg(`Could not send: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  return (
    <>
      <button disabled={busy} onClick={send} style={{ font: '600 13px system-ui', color: '#fff', background: busy ? '#9ca3af' : '#1f2a44', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Sending…' : '🏛 Send to the board to review'}
      </button>
      {msg && <span style={{ font: '12.5px system-ui', color: msg.startsWith('Could not') ? '#b91c1c' : '#166534', alignSelf: 'center' }}>{msg}</span>}
    </>
  )
}

// Communication history — every document request sent for this application, to
// whom, what was asked, and any message the owner/tenant sent back.
interface Comm { type: 'document_request' | 'approval_letter' | 'approval_sent' | 'filed_email' | 'document_decision';
  byRole?: string; docKey?: string; decision?: string; reason?: string | null; id: string; at: string; by?: string | null; ownerEmail?: string | null; tenantEmail?: string | null; ownerItems?: string[]; tenantItems?: string[]; message?: string | null; ownerNote?: string | null; tenantNote?: string | null; signers?: string[]; recipients?: string[]; subject?: string | null; body?: string; fromEmail?: string | null; fromName?: string | null; toEmails?: string[]; ccEmails?: string[]; attachmentNames?: string[] }
function CommunicationsLog({ id, unit, associationCode }: { id: string; unit: string | null; associationCode: string }) {
  const [rows, setRows] = useState<Comm[] | null>(null)
  useEffect(() => { fetch(`/api/admin/pre-apply/${id}/communications`, { credentials: 'include' }).then(r => r.json()).then(d => setRows(d.communications ?? [])).catch(() => setRows([])) }, [id])
  if (!rows) return null
  const cmd = `@maia upapp ${associationCode}${unit ?? ''}`
  // The section used to render nothing at all until the first request went
  // out, which made staff think it didn't exist. It now always shows, and
  // when it's empty it explains how to put something in it.
  return (
    <div style={{ margin: '4px 0 14px' }}>
      <div style={{ font: '700 11px system-ui', letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px' }}>Communication history</div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', padding: '8px 11px', marginBottom: 8, font: '12px system-ui', color: '#4b5563' }}>
        📨 Forward any email with the board, tenants or agents to <strong>maia@pmitop.com</strong> with <code style={{ background: '#eef2ff', color: '#3730a3', padding: '1px 6px', borderRadius: 4, font: '600 11.5px ui-monospace,monospace' }}>{cmd}</code> in the body and MAIA files it here, with its date.
      </div>
      {rows.length === 0 && <div style={{ font: '12.5px system-ui', color: '#9ca3af', padding: '2px 2px 6px' }}>Nothing filed yet — document requests, the signed approval letter, and any email you forward will appear here.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(c => c.type === 'document_decision' ? (
          <div key={c.id} style={{ border: `1px solid ${c.decision === 'approved' ? '#bbf7d0' : '#f3c9c3'}`, borderRadius: 8, padding: '9px 12px', background: c.decision === 'approved' ? '#f0fdf4' : '#fdf2f0', fontSize: 12.5 }}>
            <div style={{ color: c.decision === 'approved' ? '#166534' : '#b42318', fontWeight: 600 }}>
              {c.decision === 'approved' ? '🟢' : '🔴'} {c.docKey} {c.decision === 'approved' ? 'approved' : 'sent back'} by {c.by} · {fmt(c.at)}
            </div>
            {c.reason && <div style={{ marginTop: 4, color: '#1f2937', borderLeft: '3px solid #b42318', paddingLeft: 8 }}>“{c.reason}”</div>}
          </div>
        ) : c.type === 'filed_email' ? (
          <FiledEmailRow key={c.id} c={c} />
        ) : c.type === 'approval_sent' ? (
          <div key={c.id} style={{ border: '1px solid #bfdbfe', borderRadius: 8, padding: '9px 12px', background: '#eff6ff', fontSize: 12.5 }}>
            <div style={{ color: '#1e40af', fontWeight: 600 }}>📤 Approval letter emailed to all parties · {fmt(c.at)}</div>
            {c.recipients && c.recipients.length > 0 && <div style={{ color: '#374151', marginTop: 3 }}>{c.recipients.join(' · ')}</div>}
          </div>
        ) : c.type === 'approval_letter' ? (
          <div key={c.id} style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: '9px 12px', background: '#f0fdf4', fontSize: 12.5 }}>
            <div style={{ color: '#166534', fontWeight: 600 }}>🏛 Board approval letter signed · {fmt(c.at)}</div>
            {c.signers && c.signers.length > 0 && <div style={{ color: '#374151', marginTop: 3 }}>Signed by: {c.signers.join(', ')}</div>}
          </div>
        ) : (
          <div key={c.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px', background: '#fff', fontSize: 12.5 }}>
            <div style={{ color: '#9ca3af' }}>📩 Documents requested · {fmt(c.at)}{c.by ? ` · ${c.by.replace(/^staff:/, '')}` : ''}</div>
            {c.ownerItems && c.ownerItems.length > 0 && <div style={{ color: '#374151', marginTop: 3 }}><strong>To owner</strong>{c.ownerEmail ? ` (${c.ownerEmail})` : ''}: {c.ownerItems.join(', ')}</div>}
            {c.tenantItems && c.tenantItems.length > 0 && <div style={{ color: '#374151', marginTop: 3 }}><strong>To tenant</strong>{c.tenantEmail ? ` (${c.tenantEmail})` : ''}: {c.tenantItems.join(', ')}</div>}
            {c.message && <div style={{ color: '#6b7280', marginTop: 3, fontStyle: 'italic' }}>Note: {c.message}</div>}
            {c.ownerNote && <div style={{ marginTop: 4, color: '#1f2937', borderLeft: '3px solid #c05a1c', paddingLeft: 8 }}>💬 Owner replied: {c.ownerNote}</div>}
            {c.tenantNote && <div style={{ marginTop: 4, color: '#1f2937', borderLeft: '3px solid #c05a1c', paddingLeft: 8 }}>💬 Tenant replied: {c.tenantNote}</div>}
            <ResendRequest id={id} requestId={c.id} />
          </div>
        ))}
      </div>
    </div>
  )
}

// An email staff forwarded in with "@maia upapp <UNIT>". Long threads are
// collapsed — the timeline stays scannable and the full text is one click away.
function FiledEmailRow({ c }: { c: Comm }) {
  const [open, setOpen] = useState(false)
  const body = c.body ?? ''
  const long = body.length > 320
  const who = c.fromName ? `${c.fromName} <${c.fromEmail ?? ''}>` : (c.fromEmail ?? 'unknown sender')
  return (
    <div style={{ border: '1px solid #ddd6fe', borderRadius: 8, padding: '9px 12px', background: '#faf5ff', fontSize: 12.5 }}>
      <div style={{ color: '#6d28d9', fontWeight: 600 }}>📨 Email filed · {fmt(c.at)}</div>
      <div style={{ color: '#374151', marginTop: 3 }}><strong>From</strong> {who}</div>
      {c.toEmails && c.toEmails.length > 0 && <div style={{ color: '#6b7280', marginTop: 2 }}>To: {c.toEmails.join(', ')}{c.ccEmails && c.ccEmails.length > 0 ? ` · Cc: ${c.ccEmails.join(', ')}` : ''}</div>}
      {c.subject && <div style={{ color: '#1f2937', marginTop: 3, fontWeight: 600 }}>{c.subject}</div>}
      <div style={{ marginTop: 5, color: '#1f2937', borderLeft: '3px solid #a78bfa', paddingLeft: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {long && !open ? `${body.slice(0, 320)}…` : body}
      </div>
      {long && <button onClick={() => setOpen(o => !o)} style={{ marginTop: 5, font: '600 11.5px system-ui', color: '#6d28d9', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{open ? 'Show less' : 'Show full email'}</button>}
      {c.attachmentNames && c.attachmentNames.length > 0 && <div style={{ color: '#6b7280', marginTop: 5 }}>📎 {c.attachmentNames.join(', ')} <span style={{ color: '#b45309' }}>(names only — attachments are not stored on the application)</span></div>}
      {c.by && <div style={{ color: '#9ca3af', marginTop: 4 }}>Filed by {c.by}</div>}
    </div>
  )
}

// The owner's agent (listing_agent) + the applicant's agent (applicant_agent).
// They're CC'd on every request + communication for their side.
interface Agent { name: string; email: string; phone: string }
function AgentsCard({ id, stakeholders, onDone }: { id: string; stakeholders: { role: string; name: string | null; email: string | null; phone: string | null }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const of = (role: string): Agent => { const s = stakeholders.find(x => x.role === role); return { name: (s?.name ?? '').trim(), email: (s?.email ?? '').trim(), phone: (s?.phone ?? '').trim() } }
  const [owner, setOwner] = useState<Agent>(of('listing_agent'))
  const [appl, setAppl] = useState<Agent>(of('applicant_agent'))
  const [busy, setBusy] = useState(false)
  const has = stakeholders.some(s => s.role === 'listing_agent' || s.role === 'applicant_agent')
  const dirty = JSON.stringify(owner) !== JSON.stringify(of('listing_agent')) || JSON.stringify(appl) !== JSON.stringify(of('applicant_agent'))

  async function save() {
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/agents`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner_agent: owner, applicant_agent: appl }) })
      if (!r.ok) throw new Error((await r.json()).error || 'failed'); onDone()
    } catch (e) { alert(`Could not save: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  const inp: React.CSSProperties = { font: '13px system-ui', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6 }
  const row = (label: string, a: Agent, set: (x: Agent) => void) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
      <span style={{ font: '600 11.5px system-ui', color: '#6b7280', width: 110 }}>{label}</span>
      <input value={a.name} onChange={e => set({ ...a, name: e.target.value })} placeholder="Name" style={{ ...inp, width: 150 }} />
      <input value={a.email} onChange={e => set({ ...a, email: e.target.value })} placeholder="Email (CC'd)" style={{ ...inp, flex: '1 1 180px', minWidth: 160 }} />
      <input value={a.phone} onChange={e => set({ ...a, phone: e.target.value })} placeholder="Phone" style={{ ...inp, width: 140 }} />
    </div>
  )

  if (!open) return (
    <p style={{ margin: '8px 0 0' }}>
      <button onClick={() => setOpen(true)} style={{ font: '600 12.5px system-ui', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>👔 Agents (CC on requests){has ? ' ✓' : ''}</button>
    </p>
  )
  return (
    <div style={{ margin: '8px 0 0', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa', padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ font: '700 13px system-ui', color: '#1f2937' }}>Agents <span style={{ color: '#9ca3af', fontWeight: 400 }}>· copied on every request + communication for their side</span></span>
        <button onClick={() => setOpen(false)} style={{ font: '600 12px system-ui', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>Hide</button>
      </div>
      {row("Owner's agent", owner, setOwner)}
      {row("Applicant's agent", appl, setAppl)}
      {dirty && <button onClick={save} disabled={busy} style={{ font: '600 12px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', marginTop: 8 }}>{busy ? 'Saving…' : 'Save agents'}</button>}
    </div>
  )
}

// Vehicle/animal declarations — editable, not just displayed. Before this,
// staff could only SEE what an applicant declared through the self-serve
// link; there was nowhere to record an answer that arrived by reply email
// instead — which is exactly what the standard-reply draft now produces
// (lib/application-standard-reply.ts asks "do you have a car?" in plain
// text before ever requesting registration). One Yes/No control per
// question, editable at any time — a later correction simply overwrites the
// earlier answer, same as the applicant-facing version.
function DeclarationsCard({ id, declarations, declaredNa, petsProhibitedNotice, animalGuidance, assistanceAnimalDenialGrounds, assistanceAnimalDecisionDays, onDone }: {
  id: string
  declarations: { vehicle?: { has: boolean; at?: string } | null; animal?: { has: boolean; kind?: 'pet' | 'service' | 'esa' | 'unsure' | null; at?: string } | null }
  declaredNa: string[]
  petsProhibitedNotice: boolean
  animalGuidance: { heading: string; intro: string; mayRequest: string[]; mustNotRequest: string[]; staffNote: string } | null
  assistanceAnimalDenialGrounds: string[]
  assistanceAnimalDecisionDays: number
  onDone: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function set(body: { vehicle?: boolean; animal?: boolean; animalKind?: string }) {
    setBusy(JSON.stringify(body)); setErr(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/declarations`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const yn: React.CSSProperties = { font: '600 12px system-ui', padding: '5px 12px', borderRadius: 7, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }
  const ynOn = (c: string): React.CSSProperties => ({ ...yn, background: c, borderColor: c, color: '#fff' })

  return (
    <div style={{ border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 10, padding: '12px 14px', margin: '12px 0' }}>
      <div style={{ font: '700 12px system-ui', color: '#1e3a5f', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Vehicle & animal declaration</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0' }}>
        <span style={{ font: '13.5px system-ui', color: '#374151', width: 220 }}>🚗 Vehicle kept at the unit?</span>
        <button style={declarations.vehicle?.has === true ? ynOn('#166534') : yn} disabled={!!busy} onClick={() => set({ vehicle: true })}>Yes</button>
        <button style={declarations.vehicle?.has === false ? ynOn('#6b7280') : yn} disabled={!!busy} onClick={() => set({ vehicle: false })}>No</button>
        {typeof declarations.vehicle?.has !== 'boolean' && <span style={{ font: '12px system-ui', color: '#b45309' }}>not answered yet</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0' }}>
        <span style={{ font: '13.5px system-ui', color: '#374151', width: 220 }}>🐾 Pet / service / support animal?</span>
        <button style={declarations.animal?.has === true ? ynOn('#166534') : yn} disabled={!!busy} onClick={() => set({ animal: true, animalKind: declarations.animal?.kind ?? 'pet' })}>Yes</button>
        <button style={declarations.animal?.has === false ? ynOn('#6b7280') : yn} disabled={!!busy} onClick={() => set({ animal: false })}>No</button>
        {typeof declarations.animal?.has !== 'boolean' && <span style={{ font: '12px system-ui', color: '#b45309' }}>not answered yet</span>}
      </div>

      {declarations.animal?.has && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0 2px 230px' }}>
          {(['pet', 'service', 'esa', 'unsure'] as const).map(k => (
            <button key={k} style={declarations.animal?.kind === k ? ynOn('#5b21b6') : yn} disabled={!!busy} onClick={() => set({ animal: true, animalKind: k })}>
              {k === 'pet' ? 'Pet' : k === 'service' ? 'Service animal' : k === 'esa' ? 'Emotional support' : 'Not sure yet'}
            </button>
          ))}
        </div>
      )}
      {err && <p style={{ font: '12.5px system-ui', color: '#b91c1c', margin: '6px 0 0' }}>⚠ {err}</p>}

      {declaredNa?.length > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          Retired by this answer: {declaredNa.join(', ')}. Override any single row with <em>Undo N/A</em> below.
        </div>
      )}

      {petsProhibitedNotice && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 11px', marginTop: 9, fontSize: 12.5, color: '#92400e', lineHeight: 1.5 }}>
          ⚠ <strong>A pet was declared at an association that permits none.</strong> Contact the applicant. If the animal is
          actually a service animal or an emotional support animal, have them change the answer — the pet rule does not
          apply to either, and neither may be charged a pet fee or deposit or restricted by breed or size.
        </div>
      )}

      {animalGuidance && (declarations.animal?.kind === 'service' || declarations.animal?.kind === 'esa') && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', marginTop: 9 }}>
          <div style={{ font: '700 13px system-ui', color: '#1f2a44' }}>{animalGuidance.heading} — reasonable accommodation</div>
          <p style={{ fontSize: 12.5, color: '#4b5563', margin: '4px 0 0', lineHeight: 1.5 }}>{animalGuidance.intro}</p>
          <div style={{ fontSize: 12.5, color: '#166534', marginTop: 8, fontWeight: 700 }}>May be requested</div>
          <ul style={{ margin: '3px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#374151', lineHeight: 1.5 }}>
            {animalGuidance.mayRequest.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          <div style={{ fontSize: 12.5, color: '#991b1b', marginTop: 8, fontWeight: 700 }}>Must never be requested</div>
          <ul style={{ margin: '3px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.5 }}>
            {animalGuidance.mustNotRequest.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          {animalGuidance.staffNote && (
            <p style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '8px 10px', margin: '9px 0 0', lineHeight: 1.5 }}>{animalGuidance.staffNote}</p>
          )}
          {assistanceAnimalDenialGrounds?.length > 0 && (
            <>
              <div style={{ fontSize: 12.5, color: '#1f2a44', marginTop: 8, fontWeight: 700 }}>
                The only grounds for refusal — decide within about {assistanceAnimalDecisionDays} days of receiving the documentation
              </div>
              <ul style={{ margin: '3px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#374151', lineHeight: 1.5 }}>
                {assistanceAnimalDenialGrounds.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </>
          )}
          <p style={{ fontSize: 11.5, color: '#9ca3af', margin: '9px 0 0', lineHeight: 1.5 }}>
            MAIA organises this request; it does not decide it. Record the decision on the board decision page below.
          </p>
        </div>
      )}
    </div>
  )
}

interface Person { name: string; role: string; email: string; phone: string }
function ApplicantsCard({ id, applicants, onDone }: { id: string; applicants: { name: string | null; applicantRole: string | null; email?: string | null; phone?: string | null }[]; onDone: () => void }) {
  // Kept if they have a name OR an email OR a phone. It used to require a NAME,
  // so an occupant the owner submitted with only an email vanished from this
  // editor entirely: not shown, not editable, and — because the same seed feeds
  // `dirty` — with no button offered to save them either. Whoever the owner
  // sent is shown, and a missing name is something to fill in, not to drop.
  const seed = (): Person[] => applicants
    .map((a, i) => ({ name: (a.name ?? '').trim(), role: a.applicantRole || (i === 0 ? 'primary_applicant' : 'co_applicant'), email: (a.email ?? '').trim(), phone: (a.phone ?? '').trim() }))
    .filter(p => p.name || p.email || p.phone)
  const [people, setPeople] = useState<Person[]>(seed)
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  /** The last person removed, so it can be put back at the position it held. */
  const [removed, setRemoved] = useState<{ person: Person; at: number } | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  // The editor is seeded from props ONCE, so anything the server normalised on
  // save (a phone rewritten by normalizePhone, a role defaulted) stayed
  // different from what was typed — `dirty` never cleared, "Save applicants"
  // never went away, and every save looked like it hadn't taken. Re-seed
  // whenever the saved roster actually changes and we're not mid-edit.
  const savedKey = JSON.stringify(seed())
  const lastSaved = useRef(savedKey)
  useEffect(() => {
    if (lastSaved.current === savedKey) return
    lastSaved.current = savedKey
    if (busy) return
    setPeople(seed())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])
  const dirty = JSON.stringify(people) !== savedKey
  const primaryNoEmail = people.length > 0 && !people[0].email

  async function readFromLease() {
    setBusy('read'); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/applicants?propose=1`, { credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      if (!j.hasLease) { setMsg('Save the signed lease first, then read the contact from it.'); return }
      const have = new Set(people.map(p => p.name.toLowerCase().replace(/\s+/g, ' ')))
      const added = (j.proposed as string[]).filter(p => !have.has(p.toLowerCase().replace(/\s+/g, ' '))).map((n, k) => ({ name: n, role: people.length + k === 0 ? 'primary_applicant' : 'co_applicant', email: '', phone: '' }))
      const next = [...people, ...added]
      // Fill the lead's email/phone from the lease when we don't have them yet.
      if (next.length) { if (!next[0].email && j.proposedEmail) next[0] = { ...next[0], email: String(j.proposedEmail) }; if (!next[0].phone && j.proposedPhone) next[0] = { ...next[0], phone: String(j.proposedPhone) } }
      setPeople(next)
      const bits = [added.length ? `${added.length} name(s)` : null, j.proposedEmail ? 'email' : null, j.proposedPhone ? 'phone' : null].filter(Boolean)
      setMsg(bits.length ? `Read ${bits.join(' + ')} from the lease.` : 'No new details found — add them below.')
    } catch (e) { setMsg(`Could not read the lease: ${(e as Error).message}`) } finally { setBusy(null) }
  }
  async function save() {
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/applicants`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicants: people.map(p => ({ name: p.name, applicant_role: p.role, email: p.email, phone: p.phone })) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      setRemoved(null)
      onDone()
    } catch (e) { setMsg(`Could not save: ${(e as Error).message}`) } finally { setBusy(null) }
  }
  const upd = (i: number, patch: Partial<Person>) => setPeople(people.map((p, j) => j === i ? { ...p, ...patch } : p))
  const inpS: React.CSSProperties = { font: '13px system-ui', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6 }

  return (
    <div style={{ margin: '10px 0 0', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa', padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: collapsed ? 0 : 8 }}>
        <span style={{ font: '700 13px system-ui', color: '#1f2937' }}>Applicants <span style={{ color: '#9ca3af', fontWeight: 400 }}>· role + contact + their own document tab</span></span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={readFromLease} disabled={!!busy} style={{ font: '600 12px system-ui', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 7, padding: '5px 10px', cursor: busy ? 'default' : 'pointer' }}>{busy === 'read' ? 'Reading…' : '📄 Read from lease'}</button>
          {/* The card had no way to collapse, so the only thing that looked
              like "close" was the per-person × — which deleted that person.
              Give the card its own Hide, as the Agents card has. */}
          <button onClick={() => setCollapsed(c => !c)} style={{ font: '600 12px system-ui', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>{collapsed ? 'Show' : 'Hide'}</button>
        </span>
      </div>
      {collapsed && (
        <div style={{ font: '12.5px system-ui', color: '#6b7280', marginTop: 6 }}>
          {people.length === 0 ? 'No applicants listed.' : people.map(p => p.name || p.email || 'unnamed').join(' · ')}
          {dirty && <span style={{ color: '#b45309', fontWeight: 600 }}> · unsaved changes</span>}
        </div>
      )}
      {!collapsed && <>

      {/* Put back the person just removed. Nothing is written until Save, so the
          record is still intact — but that is impossible to know from a list
          that has simply lost a name. */}
      {removed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 11px', marginBottom: 8 }}>
          <span style={{ font: '12.5px system-ui', color: '#92400e' }}>
            Removed <strong>{removed.person.name || removed.person.email || 'a person'}</strong> from the list. Nothing is saved until you press Save.
          </span>
          <button onClick={() => { setPeople(ps => { const n = [...ps]; n.splice(Math.min(removed.at, n.length), 0, removed.person); return n }); setRemoved(null) }}
            style={{ font: '600 12px system-ui', color: '#fff', background: '#92400e', border: 'none', borderRadius: 6, padding: '4px 11px', cursor: 'pointer' }}>↩ Undo</button>
          <button onClick={() => setRemoved(null)} style={{ font: '600 12px system-ui', color: '#92400e', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {/* "No applicants yet" was shown whenever the LIST was empty, including
            when the application still has applicants that were removed on
            screen — telling staff the record was empty when it was not. */}
        {people.length === 0 && (applicants.length > 0
          ? <span style={{ font: '13px system-ui', color: '#b42318' }}>
              You have removed all {applicants.length} applicant{applicants.length === 1 ? '' : 's'} from this list. <strong>They are still on the application</strong> — reload the page to bring them back, or press Save to remove them for good.
            </span>
          : <span style={{ font: '13px system-ui', color: '#b45309' }}>No applicants yet — read them from the lease or add below.</span>)}
        {people.map((p, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input value={p.name} onChange={e => upd(i, { name: e.target.value })} placeholder="Name" style={{ ...inpS, font: '600 13px system-ui', minWidth: 150, borderColor: p.name ? '#d1d5db' : '#f59e0b' }} />
              {!p.name && <span style={{ font: '11.5px system-ui', color: '#b45309' }}>name missing</span>}
              <select value={p.role} onChange={e => upd(i, { role: e.target.value })} style={{ font: '600 12px system-ui', color: '#4338ca', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 6px', background: '#fff', cursor: 'pointer' }}>
                {APPLICANT_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              {/* This REMOVES a person from the application. It used to be a
                  bare grey "×" in the corner of a card, which reads as "close
                  this panel" — so it was clicked to collapse the row and took
                  the applicant with it, silently and with no way back. It now
                  says what it does, asks first, and can be undone. */}
              <button
                onClick={() => {
                  const label = p.name || p.email || 'this person'
                  if (!confirm(`Remove ${label} from this application?\n\nThey stay on the application until you press Save.`)) return
                  setRemoved({ person: p, at: i })
                  setPeople(people.filter((_, j) => j !== i))
                }}
                title={`Remove ${p.name || p.email || 'this person'} from this application`}
                style={{ border: '1px solid #e5e7eb', background: '#fff', color: '#b42318', cursor: 'pointer', font: '600 11.5px system-ui', padding: '3px 9px', borderRadius: 6, lineHeight: 1.4, marginLeft: 'auto' }}
              >Remove</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ font: '11px system-ui', color: '#9ca3af', width: 46 }}>✉ Email</span>
              <input value={p.email} onChange={e => upd(i, { email: e.target.value })} placeholder="email@example.com" style={{ ...inpS, flex: '1 1 180px', minWidth: 160, borderColor: i === 0 && !p.email ? '#f59e0b' : '#d1d5db' }} />
              <span style={{ font: '11px system-ui', color: '#9ca3af', width: 44 }}>☎ Phone</span>
              <input value={p.phone} onChange={e => upd(i, { phone: e.target.value })} placeholder="Phone" style={{ ...inpS, width: 150 }} />
            </div>
          </div>
        ))}
      </div>
      {primaryNoEmail && <p style={{ font: '12.5px system-ui', color: '#b45309', margin: '0 0 8px' }}>⚠ No email for the lead applicant — add it above, or 📄 read it from the lease, so MAIA can send them document requests.</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={add} onChange={e => setAdd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && add.trim()) { setPeople([...people, { name: add.trim(), role: people.length === 0 ? 'primary_applicant' : 'co_applicant', email: '', phone: '' }]); setAdd('') } }} placeholder="Add an applicant's name" style={{ font: '13px system-ui', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, width: 220 }} />
        <button onClick={() => { if (add.trim()) { setPeople([...people, { name: add.trim(), role: people.length === 0 ? 'primary_applicant' : 'co_applicant', email: '', phone: '' }]); setAdd('') } }} style={{ font: '600 12px system-ui', color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>+ Add</button>
        {/* ALWAYS shown. It used to appear only while `dirty`, so a roster that
            was already saved offered no button and no confirmation — leaving
            "where is the save button?" as the only possible reading. The state
            of the record is the thing to show, not the availability of a verb. */}
        {(() => {
          // An empty list is never a save. The API refuses it anyway ("Add at
          // least one applicant"), and reaching it by clicking Remove is far
          // likelier than actually meaning to clear the roster.
          const canSave = dirty && people.length > 0
          return <button onClick={save} disabled={!!busy || !canSave} style={{
            font: '600 12px system-ui', border: 'none', borderRadius: 6, padding: '6px 14px',
            color: canSave ? '#fff' : '#6b7280', background: canSave ? '#166534' : '#eef0f3',
            cursor: canSave && !busy ? 'pointer' : 'default',
          }}>{busy === 'save' ? 'Saving…' : canSave ? `Save ${people.length} applicant${people.length === 1 ? '' : 's'}` : '✓ Saved'}</button>
        })()}
        {people.length === 0 ? <span style={{ font: '12px system-ui', color: '#b42318' }}>Add at least one person before saving</span>
          : dirty ? <span style={{ font: '12px system-ui', color: '#b45309' }}>Unsaved changes</span>
          : <span style={{ font: '12px system-ui', color: '#9ca3af' }}>{people.length} on file — edit any field to enable saving</span>}
      </div>
      </>}
      {msg && <p style={{ font: '12.5px system-ui', color: '#6b7280', margin: '8px 0 0' }}>{msg}</p>}
    </div>
  )
}

// Recovery for an already-approved app whose Official folder got duplicates from
// the old scan-based engine: trash that folder's files + re-copy the clean saved
// keepers. Trash is reversible from Drive.
function RefileOfficial({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ trashed: number; copiedToOfficial: number; errors: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function run() {
    if (!confirm('Trash everything currently in this unit’s Official “Lease/Purchase Applications” folder and re-copy only the clean saved documents? (Trashed files are recoverable from Drive.)')) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/board-approve`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refileOfficial: true }) })
      const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || 'failed'); setRes(j); onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 14, border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 12, padding: 14 }}>
      <div style={{ font: '700 14px system-ui', color: '#9a3412' }}>🧹 Re-file Official (clean)</div>
      <div style={{ font: '400 12.5px system-ui', color: '#7c2d12', margin: '3px 0 10px' }}>Trashes the current files in this unit’s Official folder and re-copies only the clean saved keepers (one per item) — use if an earlier approval left duplicates.</div>
      {err && <p style={{ color: '#b91c1c', font: '13px system-ui' }}>⚠ {err}</p>}
      {res ? <p style={{ font: '600 13px system-ui', color: '#166534' }}>✓ Trashed {res.trashed} · copied {res.copiedToOfficial} clean keeper(s){res.errors.length ? ` · ${res.errors.length} issue(s): ${res.errors.join('; ')}` : ''}</p>
        : <button onClick={run} disabled={busy} style={{ ...btn('#9a3412'), padding: '8px 14px' }}>{busy ? 'Re-filing…' : 'Re-file Official cleanly'}</button>}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { c: string; b: string }> = { submitted: { c: '#92400e', b: '#ffedd5' }, under_review: { c: '#1d4ed8', b: '#dbeafe' }, approval_sent: { c: '#9a3412', b: '#ffedd5' }, approved: { c: '#166534', b: '#dcfce7' }, declined: { c: '#991b1b', b: '#fee2e2' } }
  const s = map[status] ?? { c: '#374151', b: '#f3f4f6' }
  return <span style={{ font: '700 12px system-ui', color: s.c, background: s.b, borderRadius: 8, padding: '4px 12px' }}>{status.replace('_', ' ')}</span>
}

const wrap: React.CSSProperties = { maxWidth: 780, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1f2a44', margin: '22px 0 6px' }
const btn = (bg: string): React.CSSProperties => ({ padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: bg, color: '#fff', font: '600 13px system-ui' })
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box' }
