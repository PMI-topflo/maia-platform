// =====================================================================
// app/admin/tickets/page.tsx
// Server component — Zendesk-style ticket list. Delegates rendering to
// the shared helper used by /admin/work-orders too.
// =====================================================================

import { renderTicketsList, type TicketsListSearchParams } from './components/renderTicketsList'

export const metadata = { title: 'Tickets — PMI Top Florida' }
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<TicketsListSearchParams>
}

export default async function TicketsPage(props: PageProps) {
  const sp = await props.searchParams
  return renderTicketsList(sp, 'ticket')
}
