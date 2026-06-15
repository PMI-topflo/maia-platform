'use client'

// =====================================================================
// BoardApprovalModal.tsx
// Popup shown from the Invoice Intake card when an invoice is linked to a
// work order: the board-approved estimate (rendered pages) + each board
// signer's signature, so Karen can confirm board approval before paying.
// =====================================================================

import { useEffect, useState } from 'react'

interface Signer { name: string; signatureImage: string | null; comments: string | null; decidedAt: string | null }
interface ApprovalData {
  approved: boolean
  reason?: string
  vendorName?: string | null
  amount?: number | null
  requiredSignatures?: number | null
  decidedAt?: string | null
  signers?: Signer[]
  pages?: string[]
}

const ET = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' })
  : '—'

export default function BoardApprovalModal({ draftId, onClose }: { draftId: number; onClose: () => void }) {
  const [data, setData] = useState<ApprovalData | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/invoices/intake/${draftId}/approved-estimate`)
      .then(r => r.json())
      .then(d => { if (live) { if (d.error) setErr(d.error); else setData(d) } })
      .catch(e => { if (live) setErr(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [draftId])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 820, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>🛡 Board approval</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: '#6b7280' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: 18 }}>
          {!data && !err && <p style={{ color: '#6b7280', fontSize: 13 }}>Loading the board approval…</p>}
          {err && <p style={{ color: '#b91c1c', fontSize: 13 }}>{err}</p>}

          {data && !data.approved && (
            <div style={{ padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: 13 }}>
              ⚠ No board-approved estimate found for this work order{data.reason ? ` — ${data.reason}.` : '.'} Confirm approval with the board before paying.
            </div>
          )}

          {data && data.approved && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'baseline', marginBottom: 14, fontSize: 13 }}>
                <span><strong>{data.vendorName ?? 'Vendor'}</strong></span>
                {data.amount != null && <span style={{ color: '#374151' }}>${Number(data.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                <span style={{ color: '#059669', fontWeight: 600 }}>✓ Approved {ET(data.decidedAt)}</span>
                <span style={{ color: '#6b7280' }}>{(data.signers?.length ?? 0)}{data.requiredSignatures ? ` of ${data.requiredSignatures}` : ''} signature{(data.signers?.length ?? 0) === 1 ? '' : 's'}</span>
              </div>

              {/* Signers + signatures */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: 6 }}>Signed by</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {(data.signers ?? []).map((s, i) => (
                    <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, minWidth: 200 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>{ET(s.decidedAt)}</div>
                      {s.signatureImage
                        ? <img src={s.signatureImage} alt={`${s.name} signature`} style={{ maxWidth: 180, maxHeight: 64, background: '#fff', border: '1px solid #f3f4f6', borderRadius: 4 }} />
                        : <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>signature on file (in the approval PDF)</div>}
                      {s.comments && <div style={{ fontSize: 11, color: '#374151', marginTop: 6 }}>“{s.comments}”</div>}
                    </div>
                  ))}
                  {(data.signers ?? []).length === 0 && <div style={{ fontSize: 12, color: '#9ca3af' }}>Signatures are in the approval document below.</div>}
                </div>
              </div>

              {/* Approved estimate + signature page images */}
              {data.pages && data.pages.length > 0 ? (
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', marginBottom: 6 }}>Approved estimate</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {data.pages.map((src, i) => (
                      <img key={i} src={src} alt={`Approval page ${i + 1}`} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6 }} />
                    ))}
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#9ca3af' }}>The signed approval PDF couldn’t be rendered here, but the signatures above confirm the board approved this estimate.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
