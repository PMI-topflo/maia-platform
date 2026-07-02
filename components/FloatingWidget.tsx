'use client'

import { usePathname } from 'next/navigation'
import MaiaWidget from './MaiaWidget'
import { associationCodeForPath } from '@/lib/association-portal'

export default function FloatingWidget() {
  const pathname = usePathname()
  // Don't render on the embedded widget page (it renders MaiaWidget itself)
  if (pathname === '/widget') return null
  // On one of the 25 association portal pages, the widget is mounted here
  // globally with no page context — without this it had no idea which
  // association it was on, so it always answered with generic PMI-wide
  // info even when opened right on that association's page.
  return <MaiaWidget associationCode={associationCodeForPath(pathname) ?? undefined} />
}
