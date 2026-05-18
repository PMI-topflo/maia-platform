import Image from 'next/image'
import UserMenu from './UserMenu'

interface SiteHeaderProps {
  subtitle: string
  children?: React.ReactNode   // optional right-side slot (e.g. lang tabs on homepage)
}

export default function SiteHeader({ subtitle, children }: SiteHeaderProps) {
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

      {/* Left — logo + subtitle */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', flexShrink: 0 }}>
        <Image
          src="/pmi-logo-white.png"
          alt="PMI Top Florida Properties"
          width={130}
          height={40}
          style={{ objectFit: 'contain', objectPosition: 'left center', flexShrink: 0 }}
          priority
        />
        <div style={{ color: '#6b7280', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>
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
