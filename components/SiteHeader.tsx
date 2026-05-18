import Image from 'next/image'
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
      background:     '#0d0d0d',
      height:         64,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '0 1.5rem',
      gap:            '1rem',
    }}>

      {/* Left — logo only (subtitle removed; identifying the section
          is the nav row's job, not duplicated text next to the brand). */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
        <Image
          src="/pmi-logo-white.png"
          alt="PMI Top Florida Properties"
          width={130}
          height={40}
          style={{ objectFit: 'contain', objectPosition: 'left center', flexShrink: 0 }}
          priority
        />
      </a>

      {/* Right — optional slot + account menu (phones removed; freed
          horizontal space for the admin nav). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        {children}
        {/* Account menu — renders only when a valid session exists,
            so this stays invisible on pre-login public pages. */}
        <UserMenu />
      </div>

    </header>
  )
}
