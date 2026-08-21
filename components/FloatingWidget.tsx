'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import MaiaWidget from './MaiaWidget'
import { associationCodeForPath } from '@/lib/association-portal'

export default function FloatingWidget() {
  const pathname = usePathname()

  // Admin application pages (app/admin/pre-apply/[id]/page.tsx) know their
  // own association + unit but aren't a portal path associationCodeForPath
  // can resolve — they dispatch this event once loaded so the widget can
  // surface the "@maia upapp <ACCOUNT>" forward-to-file hint without a
  // second fetch here. User direction, 2026-08-21: "add to the widget also
  // to make it easy for me to find it."
  const [upappHint, setUpappHint] = useState<{ code: string; unit: string } | null>(null)
  useEffect(() => {
    const onHint = (e: Event) => setUpappHint((e as CustomEvent<{ code: string; unit: string } | null>).detail ?? null)
    window.addEventListener('maia:upapp-hint', onHint)
    return () => window.removeEventListener('maia:upapp-hint', onHint)
  }, [])

  // Don't render on the embedded widget page (it renders MaiaWidget itself)
  if (pathname === '/widget') return null
  // On one of the 25 association portal pages, the widget is mounted here
  // globally with no page context — without this it had no idea which
  // association it was on, so it always answered with generic PMI-wide
  // info even when opened right on that association's page.
  return <MaiaWidget associationCode={associationCodeForPath(pathname) ?? undefined} upappHint={upappHint} />
}
