// =====================================================================
// app/admin/associations/mockup-shell/page.tsx
// DESIGN MOCKUP (not wired) — full RentVine-style app shell: collapsible
// LEFT SIDEBAR (menus + submenus) + the Association Hub in the content
// area. Isolated, staff-only. Renders its own sidebar, so no SiteHeader.
// =====================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import AssociationHubShellMock from '../mockup/AssociationHubShellMock'

export const metadata = { title: 'Association Hub shell (mockup) — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function AssociationHubShellMockPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  return <AssociationHubShellMock />
}
