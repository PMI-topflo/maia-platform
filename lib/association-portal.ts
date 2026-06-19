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
