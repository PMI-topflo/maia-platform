'use client'

// =====================================================================
// /admin/cinc-sync/ResyncWorkOrdersButton.tsx
// Small client island on the cinc-sync index. Posts to
// /api/admin/cinc-sync/resync-work-orders, which re-drives every MAIA
// work order that hasn't synced to CINC yet (resets failed 'create'
// outbox rows + enqueues any that were never queued). The drain cron
// then retries them with the current code (AssocId /associations
// fallback + 100-char description cap).
// =====================================================================

import { useState } from 'react'

export default function ResyncWorkOrdersButton() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (busy) return
    setBusy(true); setError(null); setNote(null)
    try {
      const res  = await fetch('/api/admin/cinc-sync/resync-work-orders', { method: 'POST' })
      const data = await res.json() as { unsynced?: number; reset?: number; enqueued?: number; error?: string }
      if (!res.ok) throw new Error(data?.error ?? 'Re-sync failed')
      if ((data.unsynced ?? 0) === 0) {
        setNote('All work orders already synced to CINC.')
      } else {
        setNote(`Re-queued ${(data.reset ?? 0) + (data.enqueued ?? 0)} of ${data.unsynced} unsynced work order(s). They sync within a drain cycle.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={onClick}
        disabled={busy}
        title="Retry every work order that hasn't reached CINC yet"
        className="bg-[#0d9488] hover:bg-[#0f766e] disabled:opacity-50 text-white text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded transition-colors [font-family:var(--font-mono)]"
      >
        {busy ? 'Re-syncing…' : '↻ Re-sync work orders → CINC'}
      </button>
      {note  && <span className="text-[10px] text-emerald-700 max-w-[260px] text-right">{note}</span>}
      {error && <span className="text-[10px] text-red-700 max-w-[260px] text-right">{error}</span>}
    </div>
  )
}
