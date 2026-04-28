import Image from 'next/image'

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

      {/* Left — logo + name + subtitle */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', flexShrink: 0 }}>
        <Image
          src="/pmi-icon.jpg"
          alt="PMI"
          width={40}
          height={40}
          style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
          priority
        />
        <div>
          <div style={{ color: '#fff', fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            PMI Top Florida Properties
          </div>
          <div style={{ color: '#6b7280', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 2, whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        </div>
      </a>

      {/* Right — optional slot + phone + WhatsApp */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
        {children}
        <a
          href="tel:+13059005077"
          style={{ color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textDecoration: 'none', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}
          title="Office"
        >
          📞 305.900.5077
        </a>
        <a
          href="https://wa.me/17866863223"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#25d366', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textDecoration: 'none', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}
          title="WhatsApp / SMS"
        >
          💬 (786) 686-3223
        </a>
      </div>

    </header>
  )
}
