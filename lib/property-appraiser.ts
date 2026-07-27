// =====================================================================
// lib/property-appraiser.ts
// The county Property Appraiser a Florida owner can pull their deed /
// property record from — used on the owner self-service page to explain
// Ownership Verification. County is inferred from the association's city
// (PMI's associations are Broward / Miami-Dade / Palm Beach); defaults to
// Broward, PMI's home county.
// =====================================================================

type County = 'broward' | 'miami-dade' | 'palm-beach'

const APPRAISER: Record<County, { name: string; url: string }> = {
  'broward':     { name: 'Broward County Property Appraiser',     url: 'https://web.bcpa.net/BcpaClient/#/Record-Search' },
  'miami-dade':  { name: 'Miami-Dade Property Appraiser',         url: 'https://www.miamidade.gov/Apps/PA/PropertySearch/' },
  'palm-beach':  { name: 'Palm Beach County Property Appraiser',  url: 'https://pbcpao.gov/Property' },
}

// Cities PMI manages, mapped to their county. Unknown → Broward.
const CITY_COUNTY: Record<string, County> = {
  'lauderhill': 'broward', 'inverrary': 'broward', 'hallandale beach': 'broward', 'hallandale': 'broward',
  'fort lauderdale': 'broward', 'sunrise': 'broward', 'plantation': 'broward', 'tamarac': 'broward',
  'pompano beach': 'broward', 'coral springs': 'broward', 'margate': 'broward', 'oakland park': 'broward',
  'hialeah': 'miami-dade', 'miami': 'miami-dade', 'miami gardens': 'miami-dade', 'aventura': 'miami-dade',
  'boca raton': 'palm-beach', 'delray beach': 'palm-beach', 'boynton beach': 'palm-beach', 'west palm beach': 'palm-beach',
}

export function propertyAppraiser(city: string | null | undefined): { name: string; url: string } {
  const county = CITY_COUNTY[String(city ?? '').trim().toLowerCase()] ?? 'broward'
  return APPRAISER[county]
}
