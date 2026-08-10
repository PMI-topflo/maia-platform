'use client'

// Staff Pre-Application audit view (B4 slice 3). Review one submitted intake:
// the applicant, the per-type checklist vs what was uploaded, each document
// (preview), the signed rules acknowledgment, and the Drive folder. Advance it:
// audit (PMI/Jonathan) → approve (on-site manager OR board) or decline.

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Doc { id: string; doc_key: string | null; doc_label: string | null; filename: string; mime_type: string | null; url: string | null; suggestedName: string | null; expirationDate: string | null; noExpiration: boolean; bySource: string | null; stakeholderId: string | null }
interface Detail {
  id: string; associationCode: string; type: string; unit: string | null; status: string; submittedAt: string | null
  applicant: { name: string | null; email: string | null; phone: string | null } | null
  stakeholders?: { id: string; role: string; roleLabel: string; name: string | null; email: string | null; phone: string | null; isPrimary: boolean; status: string; signs: boolean; signedAt: string | null; rulesAckName: string | null; emailVerified: boolean }[]
  rulesAck: { name?: string; at?: string } | null
  driveFolderUrl: string | null
  screeningProvider: string
  audit: { auditedBy: string | null; auditedAt: string | null; reviewedBy: string | null; reviewedAt: string | null; note: string | null; approvedByRole: string | null }
  naItems: string[]
  checklist: { doc_key: string; label: string; required: boolean; provided_by: string; per_applicant: boolean; uploaded: boolean }[]
  documents: Doc[]
}

const TYPE_LABEL: Record<string, string> = { lease: 'Lease', purchase: 'Purchase', lease_renewal: 'Lease renewal', additional_occupant: 'Additional occupant' }
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

  const loadDriveFiles = useCallback(async () => {
    const r = await fetch(`/api/admin/pre-apply/${id}/drive-files`, { credentials: 'include' })
    const j = await r.json(); setDriveFiles(Array.isArray(j.files) ? j.files : [])
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
  const docFor = (docKey: string, sid: string | null) => d.documents.find(x => x.doc_key === docKey && (x.stakeholderId ?? null) === sid)
  const naFor = (docKey: string, sid: string | null) => naSet.has(sid ? `${docKey}#${sid}` : docKey)
  // Missing required: shared items + each applicant's per-person items (minus N/A).
  const missing = [
    ...sharedItems.filter(c => c.required && !docFor(c.doc_key, null) && !naFor(c.doc_key, null)),
    ...(applicants.length ? perApplicantItems.flatMap(c => c.required ? applicants.filter(a => !docFor(c.doc_key, a.id) && !naFor(c.doc_key, a.id)).map(a => ({ label: `${c.label} — ${a.name ?? 'applicant'}` })) : []) : perApplicantItems.filter(c => c.required).map(c => ({ label: c.label }))),
  ]
  const audited = !!d.audit.auditedAt
  const decided = d.status === 'approved' || d.status === 'declined'

  return (
    <div style={wrap}>
      <Link href="/admin/pre-apply" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>← Audit queue</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{d.applicant?.name || 'Applicant'} <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 18 }}>· {TYPE_LABEL[d.type] ?? d.type}</span></h1>
        <StatusPill status={d.status} />
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '2px 0 0' }}>{d.associationCode}{d.unit ? ` · Unit ${d.unit}` : ''} · submitted {fmt(d.submittedAt)}</p>
      <p style={{ fontSize: 13, color: '#374151', margin: '4px 0 0' }}>{d.applicant?.email}{d.applicant?.phone ? ` · ${d.applicant.phone}` : ''}</p>
      <MetaEditor id={id} name={d.applicant?.name ?? ''} type={d.type} onDone={load} />
      <ApplicantsCard id={id} applicants={(d.stakeholders ?? []).filter(s => s.role === 'applicant')} onDone={load} />
      {d.driveFolderUrl && <p style={{ margin: '8px 0 0' }}><a href={d.driveFolderUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: 13, fontWeight: 600 }}>📁 Drive folder →</a></p>}

      {/* Checklist — with staff upload boxes so you can file a doc you got by email */}
      <h2 style={h2}>Documents ({d.documents.length} uploaded)</h2>
      <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 8px' }}>Upload a document you received directly here — MAIA files it into this unit&apos;s <strong>On Going Applications</strong> Drive folder. (Official only after board approval.)</p>
      {d.driveFolderUrl && <ScanDrive id={id} onDone={load} />}
      {missing.length > 0 && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, font: '13px system-ui', color: '#92400e', marginBottom: 10 }}>⚠ Missing required: {missing.map(m => m.label).join(', ')}</div>}

      {/* Shared documents — one for the whole unit / application. */}
      <div style={{ font: '700 12px system-ui', letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', margin: '2px 0 6px' }}>Shared documents</div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        {sharedItems.map((c, i) => (
          <ChecklistRow key={c.doc_key} id={id} c={c} doc={docFor(c.doc_key, null)} na={naFor(c.doc_key, null)} first={i === 0} decided={decided} onDone={load} driveFiles={driveFiles} loadDriveFiles={loadDriveFiles} />
        ))}
        {d.documents.filter(doc => !doc.stakeholderId && !d.checklist.some(c => c.doc_key === doc.doc_key)).map(doc => (
          <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderTop: '1px solid #f3f4f6', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{doc.doc_label || doc.filename} <span style={{ fontSize: 11, color: '#9ca3af' }}>(extra)</span></span>
            {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>✓ View</a>}
          </div>
        ))}
      </div>

      {/* Per-applicant documents — one column per applicant. */}
      {perApplicantItems.length > 0 && (
        <>
          <div style={{ font: '700 12px system-ui', letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', margin: '18px 0 6px' }}>Per-applicant documents</div>
          {applicants.length === 0 ? (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, font: '13px system-ui', color: '#92400e' }}>Add the applicants above (read them from the lease) to collect each person&apos;s documents in their own column.</div>
          ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {applicants.map(a => (
                <div key={a.id} style={{ flex: '1 1 340px', minWidth: 300, border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: '9px 14px', font: '700 14px system-ui', color: '#1f2937' }}>{a.name || a.email || 'Applicant'}{a.isPrimary && <span style={{ font: '600 10px system-ui', color: '#9ca3af', marginLeft: 6 }}>LEAD</span>}</div>
                  {perApplicantItems.map((c, i) => (
                    <ChecklistRow key={c.doc_key} id={id} c={c} doc={docFor(c.doc_key, a.id)} na={naFor(c.doc_key, a.id)} first={i === 0} decided={decided} onDone={load} driveFiles={driveFiles} loadDriveFiles={loadDriveFiles} stakeholderId={a.id} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
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

      {/* Board Decision Page e-sign (formal signed decision record) */}
      {d.status === 'approved' && <DecisionPageSender id={id} unit={d.unit} />}

      {/* Audit trail */}
      {(d.audit.auditedAt || d.audit.reviewedAt) && (
        <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 6 }}>
          {d.audit.auditedAt && <div>Audited by {d.audit.auditedBy} · {fmt(d.audit.auditedAt)}</div>}
          {d.audit.reviewedAt && <div>{d.status === 'approved' ? `Approved (${d.audit.approvedByRole})` : 'Decided'} by {d.audit.reviewedBy} · {fmt(d.audit.reviewedAt)}{d.audit.note ? ` — ${d.audit.note}` : ''}</div>}
        </div>
      )}

      {/* Actions */}
      {!decided && (
        <div style={{ marginTop: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fafafa' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Actions</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (required to decline or request more)" style={{ width: '100%', boxSizing: 'border-box', minHeight: 54, padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!audited && <button disabled={busy} onClick={() => act('audit')} style={btn('#2563eb')}>Mark audited (PMI/Jonathan)</button>}
            {audited && <>
              <button disabled={busy} onClick={() => act('approve', 'onsite_manager')} style={btn('#059669')}>Approve — on-site manager</button>
              <button disabled={busy} onClick={() => act('approve', 'board')} style={btn('#059669')}>Approve — board</button>
            </>}
            <button disabled={busy} onClick={() => act('request')} style={btn('#b45309')}>Request more</button>
            <button disabled={busy} onClick={() => act('decline')} style={btn('#b91c1c')}>Decline</button>
          </div>
          <p style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 10 }}>
            Audit first (PMI + Jonathan), then the on-site manager or the board approves. On approval this hands off to{' '}
            <strong>{d.screeningProvider === 'maia_checkr' ? 'MAIA + Checkr' : 'Tenant Evaluation (current system)'}</strong> for the background check — change per association on the Association Hub.
          </p>
        </div>
      )}
    </div>
  )
}

interface DecSigner { name: string | null; email: string | null; role?: string | null; hasSignature: boolean }
interface DecPrefill { applicationType: string; propertyAddress: string | null; applicant: string | null; requiredSignatures: number; defaultSigners: DecSigner[]; leaseStart: string | null; leaseEnd: string | null; occupants: string[]; applicantAsOccupant: string | null }
interface DecResult { allSigned: boolean; pdfUrl: string; signers: { name: string | null; email: string | null; signed: boolean; link: string | null }[] }

// Generates the Board Decision Page (the approval letter). Defaults the signer
// to the President; if they have an on-file signature it's signed instantly,
// else a signing link is returned. Full address, occupants, and lease term
// prefill from the association + unit records.
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
    } catch (e) { alert(`Could not create: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 18, padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#1f2a44' }}>Board Decision Page (approval letter)</div>
      <div style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 6px' }}>{pf?.propertyAddress ?? `Unit ${unit ?? '—'}`}</div>
      {pf && (
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 10 }}>
          Requires <strong>{pf.requiredSignatures}</strong> signature{pf.requiredSignatures === 1 ? '' : 's'} — {pf.defaultSigners.map(s => `${s.name}${s.hasSignature ? ' ✍' : ''}`).join(', ') || 'set board officers in Board Setup'}
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
          <button onClick={create} disabled={busy} style={{ ...btn('#059669'), alignSelf: 'flex-start' }}>{busy ? 'Creating…' : 'Create Board Decision Page'}</button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 13, color: result.allSigned ? '#166534' : '#374151', marginBottom: 8 }}>
            {result.allSigned ? '✓ Fully signed. ' : `${result.signers.filter(s => s.signed).length}/${result.signers.length} signed. Send each remaining signer their link: `}
            <a href={result.pdfUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>View letter (PDF) →</a>
          </div>
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
function ChecklistRow({ id, c, doc, na, first, decided, onDone, driveFiles, loadDriveFiles, stakeholderId }: { id: string; c: { doc_key: string; label: string; required: boolean; provided_by: string }; doc: Doc | undefined; na: boolean; first: boolean; decided: boolean; onDone: () => void; driveFiles: { fileId: string; name: string; mimeType: string }[] | null; loadDriveFiles: () => Promise<void>; stakeholderId?: string }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [keepName, setKeepName] = useState(false)
  const [pagesFor, setPagesFor] = useState<Record<string, string>>({})
  async function openPicker() { setPicking(true); if (!driveFiles) await loadDriveFiles() }
  async function assign(fileId: string, name: string, mimeType: string) {
    setBusy('assign')
    try { await fetch(`/api/admin/pre-apply/${id}/assign-drive`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: c.doc_key, doc_label: c.label, fileId, fileName: name, mimeType, pages: pagesFor[fileId] || '', keepName, stakeholder_id: stakeholderId }) }); setPicking(false); onDone() }
    catch { /* */ } finally { setBusy(null) }
  }
  const [exp, setExp] = useState(doc?.expirationDate ?? '')
  const [savedExp, setSavedExp] = useState(doc?.expirationDate ?? '')
  const [noExp, setNoExp] = useState(!!doc?.noExpiration)
  const [busy, setBusy] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(doc?.suggestedName ?? doc?.filename ?? '')
  useEffect(() => { setExp(doc?.expirationDate ?? ''); setSavedExp(doc?.expirationDate ?? ''); setNoExp(!!doc?.noExpiration); setNameVal(doc?.suggestedName ?? doc?.filename ?? '') }, [doc?.id, doc?.expirationDate, doc?.noExpiration, doc?.suggestedName, doc?.filename])
  async function saveName() { setBusy('name'); try { await patchDoc({ suggested_name: nameVal }); setEditingName(false); onDone() } catch { /* */ } finally { setBusy(null) } }

  async function patchDoc(body: Record<string, unknown>) {
    await fetch(`/api/admin/pre-apply/${id}/doc/${doc!.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }
  async function saveExp() { setBusy('exp'); try { await patchDoc({ expiration_date: exp || null }); setSavedExp(exp) } catch { /* */ } finally { setBusy(null) } }
  async function toggleNoExp(v: boolean) { setNoExp(v); if (v) { setExp(''); setSavedExp('') } try { await patchDoc({ no_expiration: v }) } catch { /* */ } }
  async function ignore() {
    if (!confirm(`Remove "${c.label}" from this application? (The file stays in Drive.)`)) return
    setBusy('ignore')
    try { await fetch(`/api/admin/pre-apply/${id}/doc/${doc!.id}`, { method: 'DELETE', credentials: 'include' }); onDone() }
    catch { /* */ } finally { setBusy(null) }
  }
  async function toggleNa() {
    setBusy('na')
    try { await fetch(`/api/admin/pre-apply/${id}/na`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_key: c.doc_key, na: !na, stakeholder_id: stakeholderId }) }); onDone() }
    catch { /* */ } finally { setBusy(null) }
  }
  const isImg = (doc?.mime_type ?? '').startsWith('image/')
  const link: React.CSSProperties = { font: '600 13px system-ui', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'none' }

  return (
    <div style={{ padding: '10px 14px', borderTop: first ? 'none' : '1px solid #f3f4f6', opacity: na ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span> <span style={{ font: '600 10px system-ui', color: '#4338ca', background: '#eef2ff', borderRadius: 5, padding: '1px 6px' }}>{c.provided_by}</span>{!c.required && <span style={{ fontSize: 11, color: '#6b7280' }}> · optional</span>}
          {doc && !na && (
            <div style={{ font: '11.5px system-ui', color: '#6b7280', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              Will file as
              {editingName ? (
                <>
                  <input value={nameVal} onChange={e => setNameVal(e.target.value)} style={{ font: '11.5px system-ui', padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 5, width: 210 }} />
                  <button onClick={saveName} disabled={busy === 'name'} style={{ font: '600 11px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer' }}>Save</button>
                  <button onClick={() => { setEditingName(false); setNameVal(doc.suggestedName ?? doc.filename) }} style={{ ...link, color: '#9ca3af', fontSize: 11 }}>Cancel</button>
                </>
              ) : (
                <>
                  <strong style={{ color: '#374151' }}>{doc.suggestedName || doc.filename}</strong>
                  <button onClick={() => setEditingName(true)} style={{ ...link, color: '#2563eb', fontSize: 11 }}>✎ rename</button>
                </>
              )}
              {doc.bySource === 'drive-scan' ? <span>· from Drive scan</span> : doc.bySource === 'esign' ? <span>· e-signed</span> : doc.bySource === 'drive-pick' ? <span>· picked from Drive</span> : null}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {na ? <span style={{ font: '600 12px system-ui', color: '#6b7280', background: '#f3f4f6', borderRadius: 6, padding: '2px 8px' }}>N/A — not applicable</span> : doc ? (
            <>
              <button onClick={() => setOpen(o => !o)} style={{ ...link, color: '#4338ca' }}>{open ? 'Hide' : '👁 Preview'}</button>
              <a href={doc.url ?? '#'} target="_blank" rel="noreferrer" style={{ ...link, color: '#166534' }}>View ↗</a>
              {!decided && <button onClick={ignore} disabled={busy === 'ignore'} style={{ ...link, color: '#b91c1c' }}>Ignore</button>}
            </>
          ) : <span style={{ fontSize: 13, color: c.required ? '#b45309' : '#9ca3af' }}>{c.required ? 'Missing' : '—'}</span>}
          {!decided && !na && <button onClick={openPicker} disabled={busy === 'assign'} style={{ ...link, color: '#2563eb', fontSize: 12 }}>{busy === 'assign' ? 'Assigning…' : '📁 From Drive'}</button>}
          {!decided && !na && <StaffUpload id={id} docKey={c.doc_key} docLabel={c.label} uploaded={!!doc} onDone={onDone} stakeholderId={stakeholderId} />}
          {!decided && !doc && <button onClick={toggleNa} disabled={busy === 'na'} style={{ ...link, color: '#9ca3af', fontSize: 12 }}>{na ? 'Undo N/A' : 'Mark N/A'}</button>}
          {!decided && na && <button onClick={toggleNa} disabled={busy === 'na'} style={{ ...link, color: '#4338ca', fontSize: 12 }}>Undo N/A</button>}
        </div>
      </div>

      {picking && (
        <div style={{ marginTop: 8, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ font: '600 12px system-ui', color: '#1e40af' }}>Pick a file for &quot;{c.label}&quot; — optionally pull just a page range (e.g. a W-2 inside a big report):</span>
            <button onClick={() => setPicking(false)} style={{ ...link, color: '#6b7280', fontSize: 12 }}>Close</button>
          </div>
          <label style={{ font: '12px system-ui', color: '#374151', display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={keepName} onChange={e => setKeepName(e.target.checked)} /> Keep the original file name (don&apos;t auto-rename)
          </label>
          {!driveFiles ? <div style={{ font: '12px system-ui', color: '#6b7280' }}>Reading Drive folder…</div>
            : driveFiles.length === 0 ? <div style={{ font: '12px system-ui', color: '#9ca3af' }}>No files in the Drive folder.</div>
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

      {doc && !na && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ font: '12px system-ui', color: '#6b7280' }}>Expires:</span>
          <input type="date" value={exp} disabled={noExp} onChange={e => setExp(e.target.value)} style={{ font: '13px system-ui', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, opacity: noExp ? 0.5 : 1 }} />
          {!noExp && exp !== savedExp && <button onClick={saveExp} disabled={busy === 'exp'} style={{ font: '600 12px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>{busy === 'exp' ? 'Saving…' : 'Save'}</button>}
          {!noExp && exp === savedExp && savedExp && <span style={{ font: '12px system-ui', color: '#166534' }}>✓ saved</span>}
          <label style={{ font: '12px system-ui', color: '#374151', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginLeft: 6 }}>
            <input type="checkbox" checked={noExp} onChange={e => toggleNoExp(e.target.checked)} /> Does not expire (keep current)
          </label>
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
function StaffUpload({ id, docKey, docLabel, uploaded, onDone, stakeholderId }: { id: string; docKey: string; docLabel: string; uploaded: boolean; onDone: () => void; stakeholderId?: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const inputId = `up-${docKey}-${stakeholderId ?? 'shared'}`

  async function onFile(file: File | null) {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('doc_key', docKey); fd.append('doc_label', docLabel)
      if (stakeholderId) fd.append('stakeholder_id', stakeholderId)
      const r = await fetch(`/api/admin/pre-apply/${id}/upload`, { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'upload failed')
      if (j?.drive && !j.drive.ok) setMsg(`Filed · Drive copy pending: ${j.drive.error}`)
      onDone()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input id={inputId} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0] ?? null)} />
      <label htmlFor={inputId} style={{ cursor: busy ? 'default' : 'pointer', font: '600 12px system-ui', color: '#fff', background: busy ? '#c9ccd3' : '#f26a1b', borderRadius: 7, padding: '5px 10px' }}>
        {busy ? 'Uploading…' : uploaded ? 'Replace' : 'Upload'}
      </label>
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
      <div style={{ font: '700 15px system-ui', color: '#166534' }}>🏛 Board approved</div>
      <div style={{ font: '400 13px system-ui', color: '#3f6212', margin: '4px 0 12px' }}>MAIA copies the <strong>documents you saved above</strong> (the keepers — Lease, HO-6, Certificate of Use, Board Approval, Decision Page, Affidavit, Agreement) into the unit’s <strong>Official</strong> folder using their approved names — one per item, no duplicates — then moves the whole application folder into <strong>OLD/Archive</strong>. Preview first — nothing moves until you confirm.</div>
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
        <button onClick={preview} disabled={busy === 'plan'} style={btn('#166534')}>{busy === 'plan' ? 'Scanning files…' : 'Board approved — preview the filing'}</button>
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
function MetaEditor({ id, name, type, onDone }: { id: string; name: string; type: string; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [nameV, setNameV] = useState(name)
  const [typeV, setTypeV] = useState(type)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setNameV(name); setTypeV(type) }, [name, type])
  async function save() {
    setBusy(true)
    try { await fetch(`/api/admin/pre-apply/${id}/meta`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicant_name: nameV, application_type: typeV }) }); setEditing(false); onDone() }
    catch { /* */ } finally { setBusy(false) }
  }
  if (!editing) return (
    <p style={{ fontSize: 13, color: '#374151', margin: '6px 0 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span><strong>Applicant:</strong> {name || <span style={{ color: '#b45309' }}>not set</span>}</span>
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
function ApplicantsCard({ id, applicants, onDone }: { id: string; applicants: { name: string | null }[]; onDone: () => void }) {
  const [names, setNames] = useState<string[]>(applicants.map(a => (a.name ?? '').trim()).filter(Boolean))
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const dirty = JSON.stringify(names) !== JSON.stringify(applicants.map(a => (a.name ?? '').trim()).filter(Boolean))

  async function readFromLease() {
    setBusy('read'); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/applicants?propose=1`, { credentials: 'include' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      if (!j.hasLease) { setMsg('Save the signed lease first, then read the names from it.'); return }
      const have = new Set(names.map(n => n.toLowerCase().replace(/\s+/g, ' ')))
      const merged = [...names, ...(j.proposed as string[]).filter(p => !have.has(p.toLowerCase().replace(/\s+/g, ' ')))]
      setNames(merged); setMsg(j.proposed.length ? `Read ${j.proposed.length} name(s) from the lease.` : 'No names found on the lease — add them below.')
    } catch (e) { setMsg(`Could not read the lease: ${(e as Error).message}`) } finally { setBusy(null) }
  }
  async function save() {
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch(`/api/admin/pre-apply/${id}/applicants`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed')
      onDone()
    } catch (e) { setMsg(`Could not save: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  return (
    <div style={{ margin: '10px 0 0', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa', padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ font: '700 13px system-ui', color: '#1f2937' }}>Applicants <span style={{ color: '#9ca3af', fontWeight: 400 }}>· each gets their own document column</span></span>
        <button onClick={readFromLease} disabled={!!busy} style={{ font: '600 12px system-ui', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 7, padding: '5px 10px', cursor: busy ? 'default' : 'pointer' }}>{busy === 'read' ? 'Reading…' : '📄 Read names from lease'}</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {names.length === 0 && <span style={{ font: '13px system-ui', color: '#b45309' }}>No applicants yet — read them from the lease or add below.</span>}
        {names.map((n, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 13px system-ui', color: '#1f2937', background: '#fff', border: '1px solid #d1d5db', borderRadius: 999, padding: '4px 10px' }}>
            {i === 0 && <span title="Lead applicant" style={{ color: '#9ca3af', fontWeight: 700, fontSize: 10 }}>LEAD</span>}
            {n}
            <button onClick={() => setNames(names.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', font: '700 13px system-ui', padding: 0, lineHeight: 1 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={add} onChange={e => setAdd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && add.trim()) { setNames([...names, add.trim()]); setAdd('') } }} placeholder="Add an applicant's name" style={{ font: '13px system-ui', padding: '6px 9px', border: '1px solid #d1d5db', borderRadius: 6, width: 220 }} />
        <button onClick={() => { if (add.trim()) { setNames([...names, add.trim()]); setAdd('') } }} style={{ font: '600 12px system-ui', color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>+ Add</button>
        {dirty && <button onClick={save} disabled={!!busy} style={{ font: '600 12px system-ui', color: '#fff', background: '#166534', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: busy ? 'default' : 'pointer' }}>{busy === 'save' ? 'Saving…' : 'Save applicants'}</button>}
      </div>
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
  const map: Record<string, { c: string; b: string }> = { submitted: { c: '#92400e', b: '#ffedd5' }, under_review: { c: '#1d4ed8', b: '#dbeafe' }, approved: { c: '#166534', b: '#dcfce7' }, declined: { c: '#991b1b', b: '#fee2e2' } }
  const s = map[status] ?? { c: '#374151', b: '#f3f4f6' }
  return <span style={{ font: '700 12px system-ui', color: s.c, background: s.b, borderRadius: 8, padding: '4px 12px' }}>{status.replace('_', ' ')}</span>
}

const wrap: React.CSSProperties = { maxWidth: 780, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1f2a44', margin: '22px 0 6px' }
const btn = (bg: string): React.CSSProperties => ({ padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: bg, color: '#fff', font: '600 13px system-ui' })
const inp: React.CSSProperties = { padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box' }
