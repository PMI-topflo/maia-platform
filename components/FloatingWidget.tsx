'use client'

import { usePathname } from 'next/navigation'
import MaiaWidget from './MaiaWidget'

export default function FloatingWidget() {
  const pathname = usePathname()
  // Don't render on the embedded widget page (it renders MaiaWidget itself)
  if (pathname === '/widget') return null
  return <MaiaWidget />
}
