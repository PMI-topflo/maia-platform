// =====================================================================
// lib/association-portal-config.ts
//
// Per-association overrides for the shared <AssociationPortal> component.
// Most associations use the defaults; only the exceptions are listed.
//
// ⚠ KNOWN DATA ISSUE (pre-existing, flagged for cleanup): 24 of 25 portals
// historically pointed ALL document cards at one shared Google Drive folder
// (1RGGBxke…). That's preserved here as DEFAULT_DOCS_FOLDER so nothing
// regresses, but each association should get its OWN folder over time (set
// `docsFolder` per code, or move documents to the DB). Galleria Village
// (GVH) already has real per-category folders and keeps its bespoke page
// until documents are DB-backed.
// =====================================================================

/** The single Drive folder 24 portals currently share. Preserved as the
 *  default so the refactor changes layout only, not document destinations. */
export const DEFAULT_DOCS_FOLDER = 'https://drive.google.com/drive/folders/1RGGBxke8umRS6kH9PTX4P-SJmvuHCsJh'

export interface PortalConfig {
  /** Hide the Estoppel quick action (e.g. rec associations with no resales). */
  hideEstoppel?: boolean
  /** Hide the Tenant/Buyer Application quick action. */
  hideApplication?: boolean
  /** Per-association documents Drive folder. Defaults to DEFAULT_DOCS_FOLDER. */
  docsFolder?: string
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
    docsFolder:      c.docsFolder ?? DEFAULT_DOCS_FOLDER,
  }
}
