// =====================================================================
// lib/association-portal-config.ts
//
// Per-association overrides for the shared <AssociationPortal> component.
// Most associations use the defaults; only the exceptions are listed.
//
// Documents are now served from MAIA (see lib/portal-documents.ts) — the
// old Google Drive folder links were removed entirely.
// =====================================================================

export interface PortalConfig {
  /** Hide the Estoppel quick action (e.g. rec associations with no resales). */
  hideEstoppel?: boolean
  /** Hide the Tenant/Buyer Application quick action. */
  hideApplication?: boolean
}

export const PORTAL_CONFIG: Record<string, PortalConfig> = {
  // Lakeview of the California Club (HOA) — no Estoppel / Application here.
  LCLUB: { hideEstoppel: true, hideApplication: true },
  // Venetian Park Recreation Association — amenities only, no resales/leasing.
  VPREC: { hideEstoppel: true, hideApplication: true },
}

export function portalConfig(code: string): Required<PortalConfig> {
  const c = PORTAL_CONFIG[code.toUpperCase()] ?? {}
  return {
    hideEstoppel:    c.hideEstoppel ?? false,
    hideApplication: c.hideApplication ?? false,
  }
}
