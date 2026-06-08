import Image from 'next/image'
import Link from 'next/link'
import UserMenu from './UserMenu'

interface SiteHeaderProps {
  // Subtitle prop is tolerated but no longer rendered — callers still
  // pass things like "STAFF DASHBOARD" but the text was redundant with
  // the Overview/Dashboard nav tab and ate horizontal space.
  subtitle?: string
  children?: React.ReactNode   // optional right-side slot (e.g. lang tabs on homepage)
}

export default function SiteHeader({ children }: SiteHeaderProps) {
  return (
    <header style={{
      position:       'sticky',
      top:            0,
      zIndex:         50,
      background:     '#ffffff',
      borderBottom:   '1px solid #e5e7eb',
      boxShadow:      '0 1px 2px rgba(0,0,0,0.04)',
      minHeight:      64,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '0.5rem 1.5rem',
      gap:            '1rem',
    }}>

      {/* Left — logo only (subtitle removed; identifying the section
          is the nav row's job, not duplicated text next to the brand). */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
        <Image
          src="/maia-logo-primary.svg"
          alt="Maia by PMI Top Florida Properties"
          width={168}
          height={32}
          style={{ objectFit: 'contain', objectPosition: 'left center', flexShrink: 0 }}
          priority
        />
      </Link>

      {/* Right — optional slot + account menu (phones removed; freed
          horizontal space for the admin nav). The group grows (flex:1)
          so a stretchable child like AdminNav (flex-1) can fill from just
          after the logo; shrink-wrapped children (e.g. homepage language
          tabs) still sit flush right via justify-end. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
        {children}
        {/* Account menu — renders only when a valid session exists,
            so this stays invisible on pre-login public pages. */}
        <UserMenu />
      </div>

    </header>
  )
}
