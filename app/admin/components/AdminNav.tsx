// =====================================================================
// app/admin/components/AdminNav.tsx
// DEPRECATED top horizontal nav — navigation now lives in the left
// AdminSidebar (mounted by app/admin/layout.tsx). Kept as a no-op so the
// ~24 pages that still pass <AdminNav/> into SiteHeader don't all need
// editing; the top bar now just shows the Maia logo + account menu.
// =====================================================================

interface Props {
  /** Retained for call-site compatibility; no longer used. */
  activeOverride?: string
}

export default function AdminNav(props: Props = {}) {
  void props
  return null
}
