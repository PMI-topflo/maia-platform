'use client'

// =====================================================================
// CheckrConsentEmbed.tsx
// Checkr's Disclosure & Consent Embed for one screening subject — the
// legally-required step (disclosure text + e-signature + IP/timestamp
// capture) that must complete before we're allowed to create that
// subject's Report. On completion we call our own consent-recording route,
// which creates the Report server-side.
//
// ⚠ NOT verified against a live Checkr account — there is no CHECKR_API_KEY
// configured anywhere in this repo yet, and the embed's exact script URL /
// initialization call are syntax-sensitive and can change between Checkr
// SDK versions. Before shipping this to real applicants, confirm the
// script src and init call against:
//   https://docs.checkr.com/embeds/#section/Disclosure-and-Consent-Embed
// and update `loadCheckrScript()` / `initEmbed()` below to match exactly.
// =====================================================================

import { useEffect, useRef, useState } from 'react'

interface Props {
  applicationId: string
  subjectId: string
  candidateId: string
  onComplete?: () => void
}

// Checkr's embed script — confirm this URL against the Disclosure & Consent
// Embed doc section before go-live; this is Checkr's documented CDN host as
// of when this was written, but embed script paths do change between SDK
// versions.
const CHECKR_SDK_SRC = 'https://checkr-web-sdk.imgix.net/checkr-web-sdk.js'

function loadCheckrScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${CHECKR_SDK_SRC}"]`)) { resolve(); return }
    const script = document.createElement('script')
    script.src = CHECKR_SDK_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load the Checkr consent widget.'))
    document.body.appendChild(script)
  })
}

export default function CheckrConsentEmbed({ applicationId, subjectId, candidateId, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'done' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        await loadCheckrScript()
        if (cancelled || !containerRef.current) return

        // ⚠ Placeholder initialization — replace with the exact call from
        // Checkr's Disclosure & Consent Embed doc once verified. The
        // structure (container element, candidate id, completion callback)
        // is Checkr's documented pattern; the exact global/function name
        // needs a live-docs check.
        const checkrGlobal = (window as unknown as { Checkr?: { renderDisclosureConsent?: (opts: Record<string, unknown>) => void } }).Checkr
        if (!checkrGlobal?.renderDisclosureConsent) {
          throw new Error('Checkr embed script loaded but the expected init function was not found — verify the SDK version/API against docs.checkr.com.')
        }
        checkrGlobal.renderDisclosureConsent({
          container: containerRef.current,
          candidateId,
          onComplete: () => { if (!cancelled) void submitConsent() },
          onError: (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
        })
        if (!cancelled) setStatus('ready')
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setStatus('error') }
      }
    }

    async function submitConsent() {
      setStatus('submitting'); setError(null)
      try {
        const res = await fetch(`/api/screening/${subjectId}/consent`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId }),
        })
        const j = await res.json()
        if (!res.ok) throw new Error(j?.error ?? 'failed')
        setStatus('done')
        onComplete?.()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e)); setStatus('error')
      }
    }

    void init()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId, subjectId, applicationId])

  if (status === 'done') return <p className="text-sm text-emerald-700">✓ Background check authorized.</p>

  return (
    <div>
      <div ref={containerRef} />
      {status === 'loading' && <p className="text-sm text-gray-400">Loading background-check authorization…</p>}
      {status === 'submitting' && <p className="text-sm text-gray-400">Submitting…</p>}
      {error && <p className="text-sm text-red-600">⚠ {error}</p>}
    </div>
  )
}
