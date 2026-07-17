'use client'

// =====================================================================
// SendInvoiceToBoardModal.tsx
// Popup from the Invoice Intake card — staff pick which of the
// configured 'invoice' committee members get the approval link (defaults
// to the whole committee). Optional: sending doesn't block pushing to
// CINC, and pushing doesn't require this to have happened.
// =====================================================================

import { useState } from 'react'
import BoardMemberPicker from '@/app/admin/components/BoardMemberPicker'

export default function SendInvoiceToBoardModal({
  draftId,
  associationCode,
  vendorName,
  amount,
  onClose,
  onSent,
}: {
  draftId: number
  associationCode: string
  vendorName: string | null
  amount: number | null
  onClose: () => void
  onSent: () => void
}) {
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function send() {
    setSending(true); setError(null)
    try {
      const res = await fetch(`/api/admin/invoices/intake/${draftId}/send-to-board`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signer_ids: memberIds }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? 'failed')
      setResult(`Sent to ${d.sent} board member(s) — needs ${d.required} decider approval(s).`)
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflow: 'auto' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 520, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>🏛️ Send for board approval</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: '#6b7280' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
            <strong>{vendorName ?? 'Vendor'}</strong>{amount != null ? ` · $${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
          </div>

          <BoardMemberPicker associationCode={associationCode} purpose="invoice" value={memberIds} onChange={setMemberIds} label="Recipients" />

          {error && <div style={{ marginTop: 10, fontSize: 13, color: '#991b1b' }}>⚠ {error}</div>}
          {result && <div style={{ marginTop: 10, fontSize: 13, color: '#065f46' }}>✓ {result}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {!result && (
              <button onClick={send} disabled={sending || memberIds.length === 0} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: sending || memberIds.length === 0 ? 0.5 : 1 }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            )}
            <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {result ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
