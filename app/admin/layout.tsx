// =====================================================================
// app/admin/layout.tsx
// Wraps every /admin/* page in the left-sidebar app shell. The sidebar
// is fixed on the left (md+); the page content (which still renders its
// own light SiteHeader top bar + body) is offset to the right. The old
// horizontal AdminNav now renders nothing (nav lives in the sidebar).
// =====================================================================

import AdminSidebar from './components/AdminSidebar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminSidebar />
      <div className="md:ml-[232px]">{children}</div>
    </>
  )
}
