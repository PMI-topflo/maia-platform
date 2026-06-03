// =====================================================================
// app/admin/ideas/page.tsx
//
// Admin board for staff MAIA-improvement ideas (submitted via the
// daily-news email link). Route is guarded by middleware (staff); the
// interactive board + its API also verify the staff session.
// =====================================================================

import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import IdeasBoard from './IdeasBoard'

export const metadata = { title: 'Improvement Ideas — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default function IdeasPage() {
  return (
    <>
      <SiteHeader subtitle="IMPROVEMENT IDEAS"><AdminNav /></SiteHeader>
      <IdeasBoard />
    </>
  )
}
