import { redirect } from 'next/navigation'
import Link from 'next/link'
import SiteHeader from '@/components/SiteHeader'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Maps every known slug (lowercase) → canonical path served by a static page
const SLUG_MAP: Record<string, string> = {
  // ── Static folder names (case-insensitive fallback) ─────────────────────────
  'abbott':         '/abbott',
  'brook':          '/brook',
  'crystalh':       '/crystalh',
  'delvista':       '/delvista',
  'essi':           '/essi',
  'fifth':          '/fifth',
  'galleriav':      '/galleriav',
  'goldkey':        '/goldkey',
  'islandhouse':    '/islandhouse',
  'kane':           '/kane',
  'kimgarden':      '/kimgarden',
  'lafarms':        '/lafarms',
  'lakeview':       '/lakeview',
  'maco':           '/maco',
  'manorsxi':       '/manorsxi',
  'onebay':         '/onebay',
  'parcview':       '/parcview',
  'serenityiv':     '/serenityiv',
  'shoreland':      '/shoreland',
  'venetian1':      '/venetian1',
  'venetian2':      '/venetian2',
  'venetian5':      '/venetian5',
  'venetianrec':    '/venetianrec',
  'wedgewood57':    '/wedgewood57',
  'wedgewoodansin': '/wedgewoodansin',

  // ── Association codes → canonical paths ──────────────────────────────────────
  'bhb':         '/brook',
  'chv':         '/crystalh',
  'dela':        '/delvista',
  'gk7':         '/goldkey',
  'gvh':         '/galleriav',
  'island':      '/islandhouse',
  'kga':         '/kimgarden',
  'lclub':       '/lakeview',
  'lfa':         '/lafarms',
  'manxi':       '/manorsxi',
  'one':         '/onebay',
  'pvv':         '/parcview',
  'shore':       '/shoreland',
  'sp':          '/serenityiv',
  'vpc5':        '/venetian5',
  'vpci':        '/venetian1',
  'vpcii':       '/venetian2',
  'vprec':       '/venetianrec',
  'wbp':         '/wedgewood57',
  'wbpa':        '/wedgewoodansin',

  // ── Common short aliases ──────────────────────────────────────────────────────
  'wedge57':     '/wedgewood57',
  'wedgewood':   '/wedgewood57',
  'serenity':    '/serenityiv',
  'manors':      '/manorsxi',
}

// Supabase association_code → canonical path (for unknown slugs that still
// match a code via case-insensitive or partial lookup)
const CODE_TO_PATH: Record<string, string> = {
  'ABBOTT': '/abbott',
  'BHB':    '/brook',
  'CHV':    '/crystalh',
  'DELA':   '/delvista',
  'ESSI':   '/essi',
  'FIFTH':  '/fifth',
  'GK7':    '/goldkey',
  'GVH':    '/galleriav',
  'ISLAND': '/islandhouse',
  'KANE':   '/kane',
  'KGA':    '/kimgarden',
  'LCLUB':  '/lakeview',
  'LFA':    '/lafarms',
  'MACO':   '/maco',
  'MANXI':  '/manorsxi',
  'ONE':    '/onebay',
  'PVV':    '/parcview',
  'SHORE':  '/shoreland',
  'SP':     '/serenityiv',
  'VPC5':   '/venetian5',
  'VPCI':   '/venetian1',
  'VPCII':  '/venetian2',
  'VPREC':  '/venetianrec',
  'WBP':    '/wedgewood57',
  'WBPA':   '/wedgewoodansin',
}

export default async function AssocSlugPage(props: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await props.params
  const normalized = slug.toLowerCase()

  // 1. Static map lookup (fast path — covers codes + aliases + folder names)
  const mapped = SLUG_MAP[normalized]
  if (mapped) {
    // Only redirect if the current path isn't already the canonical path
    // (avoids redirect loops for slugs that match their own canonical path)
    redirect(mapped)
  }

  // 2. Supabase fallback — exact code match (case-insensitive)
  const { data: exactMatch } = await supabaseAdmin
    .from('associations')
    .select('association_code')
    .ilike('association_code', normalized)
    .eq('active', true)
    .limit(1)
    .single()

  if (exactMatch?.association_code) {
    const path = CODE_TO_PATH[exactMatch.association_code]
    if (path) redirect(path)
  }

  // 3. Supabase fallback — partial match (e.g. "island" inside "ISLANDHOUSE")
  const { data: partialMatches } = await supabaseAdmin
    .from('associations')
    .select('association_code')
    .ilike('association_code', `%${normalized}%`)
    .eq('active', true)
    .limit(1)

  if (partialMatches && partialMatches.length > 0) {
    const path = CODE_TO_PATH[partialMatches[0].association_code]
    if (path) redirect(path)
  }

  // 4. No match — render friendly 404
  return (
    <main className="assoc-page">
      <div className="assoc-topbar">
        <span className="assoc-topbar-l">WHATSAPP &amp; SMS 24/7 · +1 (786) 686-3223 · WE SPEAK ENGLISH, SPANISH, FRENCH &amp; PORTUGUESE</span>
        <span className="assoc-topbar-r">305.900.5077</span>
      </div>

      <SiteHeader subtitle="ASSOCIATION NOT FOUND" />

      <div className="section" style={{ paddingTop: '3rem', paddingBottom: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏢</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 300, color: 'var(--navy)', marginBottom: '0.5rem' }}>
          Association Not Found
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
          /{slug}
        </p>
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem', maxWidth: '400px', margin: '1rem auto 2rem', lineHeight: 1.6 }}>
          We couldn&apos;t find an association page for that URL. Please check the link or contact PMI for assistance.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/"
            style={{ background: 'var(--gold)', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.6rem 1.25rem', borderRadius: '2px', textDecoration: 'none' }}
          >
            ← Back to Home
          </Link>
          <a
            href="mailto:PMI@topfloridaproperties.com"
            style={{ border: '1px solid var(--border)', color: 'var(--navy)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.6rem 1.25rem', borderRadius: '2px', textDecoration: 'none' }}
          >
            Contact PMI
          </a>
        </div>
      </div>
    </main>
  )
}
