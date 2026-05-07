// =====================================================================
// app/admin/work-orders/page.tsx
// Server component — work-orders list. Reuses the tickets list renderer
// with type=work_order locked + extra columns enabled.
// =====================================================================

import { renderTicketsList, type TicketsListSearchParams } from '../tickets/components/renderTicketsList'

export const metadata = { title: 'Work Orders — PMI Top Florida' }
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<TicketsListSearchParams>
}

export default async function WorkOrdersPage(props: PageProps) {
  const sp = await props.searchParams
  return renderTicketsList(sp, 'work_order')
}
