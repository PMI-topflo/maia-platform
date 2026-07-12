// =====================================================================
// lib/association-portal.ts
//
// Maps an association_code → its public resident-portal path — the page a
// unit owner logs into and the general public sees (then identifies /
// registers for more). These are the same canonical paths the /[slug]
// router redirects to. Single source of truth so the admin hub, the slug
// router, and anything else link to the same place.
// =====================================================================

export const ASSOCIATION_PORTAL_PATH: Record<string, string> = {
  ABBOTT: '/abbott',
  BHB:    '/brook',
  CHV:    '/crystalh',
  DELA:   '/delvista',
  ESSI:   '/essi',
  FIFTH:  '/fifth',
  GK7:    '/goldkey',
  GVH:    '/galleriav',
  ISLAND: '/islandhouse',
  KANE:   '/kane',
  KGA:    '/kimgarden',
  LCLUB:  '/lakeview',
  LFA:    '/lafarms',
  MACO:   '/maco',
  MANXI:  '/manorsxi',
  ONE:    '/onebay',
  PVV:    '/parcview',
  SHORE:  '/shoreland',
  SP:     '/serenityiv',
  TROP:   '/tropicana2',
  VPC5:   '/venetian5',
  VPCI:   '/venetian1',
  VPCII:  '/venetian2',
  VPREC:  '/venetianrec',
  WBP:    '/wedgewood57',
  WBPA:   '/wedgewoodansin',
}

/** Resident-portal path for an association code, or null if none is mapped. */
export function associationPortalPath(code: string | null | undefined): string | null {
  if (!code) return null
  return ASSOCIATION_PORTAL_PATH[code.toUpperCase()] ?? null
}

// Inverted once at module load — path (leading slash, no trailing slash) → code.
const PATH_TO_ASSOCIATION: Record<string, string> = Object.fromEntries(
  Object.entries(ASSOCIATION_PORTAL_PATH).map(([code, path]) => [path, code]),
)

/** Association code for a resident-portal path (or any sub-path under it),
 *  or null if the path isn't one of the 25 association portals. Lets a
 *  globally-mounted component (e.g. the floating MAIA widget) infer which
 *  association it's on from `usePathname()`. */
export function associationCodeForPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const first = '/' + pathname.split('/').filter(Boolean)[0]
  return PATH_TO_ASSOCIATION[first] ?? null
}
