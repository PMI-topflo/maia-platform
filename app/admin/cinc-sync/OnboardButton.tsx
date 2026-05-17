'use client'

// =====================================================================
// /admin/cinc-sync/OnboardButton.tsx
// Small client island on the otherwise-server-rendered cinc-sync index.
// Posts to /api/admin/cinc-sync/onboard to create the MAIA associations
// row, then redirects into the diff page so staff can immediately import
// the owners + board members for that association.
// =====================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  assocCode: string
  assocName: string
}

export default function OnboardButton({ assocCode, assocName }: Props) {
  const router = useRouter()
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (busy) return
    // Light-touch confirm so a misclick doesn't create a row staff
    // will then have to clean up. Names are CINC-authoritative so it's
    // safe to surface the exact text.
    const ok = window.confirm(
      `Onboard "${assocName}" (${assocCode}) into MAIA?\n\n` +
      `This creates an empty association row using CINC's name. You'll then ` +
      `land on the diff page to pick which owners and board members to import.`,
    )
    if (!ok) return

    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/admin/cinc-sync/onboard', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assocCode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Onboard failed')
      // Send them to the documents library first. The biggest gap a
      // brand-new association has isn't owners (CINC carries those) —
      // it's the governing docs + insurance policies MAIA needs to
      // answer owner questions. Staff can navigate one click over to
      // the owner/board diff page from there.
      router.push(`/admin/cinc-sync/${assocCode}/documents`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={onClick}
        disabled={busy}
        className="bg-[#f26a1b] hover:bg-[#f58140] disabled:opacity-50 text-white text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded transition-colors [font-family:var(--font-mono)]"
      >
        {busy ? 'Onboarding…' : '+ Onboard →'}
      </button>
      {error && <span className="text-[10px] text-red-700">{error}</span>}
    </div>
  )
}
