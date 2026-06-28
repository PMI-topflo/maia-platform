// =====================================================================
// lib/office-hours.ts
// Builds a small system-prompt block telling MAIA the current Eastern
// Time and whether the PMI office is OPEN or CLOSED right now. Used by
// the customer-facing chat + email-general-question handlers so the
// pmi-triage-policy skill has live context to compare against.
//
// Office hours (per PMI policy):
//   Monday – Thursday: 10:00 AM – 5:00 PM ET
//   Friday:            10:00 AM – 3:00 PM ET
//   Saturday – Sunday: closed
// =====================================================================

const TZ = 'America/New_York'

interface EtParts {
  weekday: number  // 0=Sun ... 6=Sat
  hour:    number
  minute:  number
}

function nowInEt(): EtParts {
  // Intl gives us individual fields in the right zone without bringing in
  // a tz library. We want weekday + hour + minute.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday:  'short',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   false,
  })
  const parts = fmt.formatToParts(new Date())
  const get   = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    weekday: wkMap[get('weekday')] ?? 0,
    hour:    Number(get('hour')),
    minute:  Number(get('minute')),
  }
}

export function isOfficeOpen(): boolean {
  const { weekday, hour, minute } = nowInEt()
  const minutes = hour * 60 + minute
  const tenAm   = 10 * 60
  const fivePm  = 17 * 60
  const threePm = 15 * 60

  if (weekday >= 1 && weekday <= 4) {
    return minutes >= tenAm && minutes < fivePm   // Mon–Thu 10:00–17:00
  }
  if (weekday === 5) {
    return minutes >= tenAm && minutes < threePm  // Fri 10:00–15:00
  }
  return false                                     // Sat/Sun closed
}

export function formatEtNow(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone:    TZ,
    weekday:     'long',
    year:        'numeric',
    month:       'long',
    day:         'numeric',
    hour:        'numeric',
    minute:      '2-digit',
    timeZoneName: 'short',
  }).format(new Date())
}

/** Returns a small system-prompt block. Intended to be appended to the
 *  customer-facing system prompt right before the skills block, so the
 *  pmi-triage-policy skill has live context to use when phrasing
 *  response windows. */
export function buildOfficeHoursBlock(): string {
  const open = isOfficeOpen()
  return `\n\n--- LIVE CONTEXT ---\nCurrent time: ${formatEtNow()}\nPMI office is currently: ${open ? 'OPEN' : 'CLOSED'}\nOffice hours: Mon–Thu 10:00am–5:00pm ET, Fri 10:00am–3:00pm ET, weekends closed.\nWhen the office is closed, do NOT invent the time of day (e.g. "it's late" or "Sunday night") — state only the day/hours from the time above.\n--------------------\n`
}
