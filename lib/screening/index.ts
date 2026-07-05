// =====================================================================
// lib/screening/index.ts
// The active background-check provider. Callers should import `screening`
// from here, never a specific provider file directly — that's the whole
// point of the ScreeningProvider interface (swap providers without
// touching trigger/consent/webhook route logic).
// =====================================================================

import { checkrProvider } from './checkr'
import type { ScreeningProvider } from './types'

export const screening: ScreeningProvider = checkrProvider

export * from './types'
