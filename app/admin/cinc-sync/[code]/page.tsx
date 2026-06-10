import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getContactsAndConsentFlag, getAssociationMeta, listAssociationBankAccounts, getAssociationBudget } from '@/lib/integrations/cinc'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../../components/AdminNav'
import AssociationHubClient, { type AssociationHubData } from './AssociationHubClient'

export const metadata = { title: 'Association Hub — PMI Top Florida' }
export const dynamic = 'force-dynamic'

const OPEN_WO_STATUSES = ['open', 'pending', 'waiting_external']
const OPEN_INVOICE_STATUSES = ['pending_review', 'ready_to_push', 'needs_vendor']

export default async function AssociationHubPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params
  const upperCode = code.toUpperCase()

  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: assocRow } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name, service_type')
    .eq('association_code', upperCode)
    .maybeSingle()

  if (!assocRow) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
        <main className="max-w-screen-2xl mx-auto px-6 py-6">
          <Link href="/admin/cinc-sync" className="text-xs text-[#f26a1b] hover:underline [font-family:var(--font-mono)]">← Back to all associations</Link>
          <div className="mt-4 bg-white border border-amber-200 rounded-lg p-6 text-sm text-amber-800">
            No association found with code <code className="bg-amber-50 px-1 rounded">{upperCode}</code>.
          </div>
        </main>
      </div>
    )
  }

  // Fetch every tab's data in parallel. CINC calls and optional tables are
  // wrapped so one failure can't blank the whole hub.
  const [
    contactsFlagOn,
    meta,
    bankAccounts,
    budget,
    { data: boardRows },
    { data: woRows },
    { count: docCount },
    { count: invoiceCount },
    { count: ownersCount },
  ] = await Promise.all([
    getContactsAndConsentFlag().catch(() => null),
    getAssociationMeta(upperCode).catch(() => null),
    listAssociationBankAccounts(upperCode).catch(() => []),
    getAssociationBudget(upperCode).catch(() => []),
    supabaseAdmin.from('association_board_members').select('id, name, email, role').eq('association_code', upperCode).eq('active', true),
    supabaseAdmin.from('tickets').select('id, ticket_number, subject, status, priority, due_at').eq('type', 'work_order').eq('association_code', upperCode).is('archived_at', null).order('updated_at', { ascending: false }).limit(50),
    supabaseAdmin.from('association_documents').select('id', { count: 'exact', head: true }).eq('association_code', upperCode).is('archived_at', null),
    supabaseAdmin.from('invoice_intake_drafts').select('id', { count: 'exact', head: true }).eq('extracted_association_code', upperCode).in('status', OPEN_INVOICE_STATUSES),
    supabaseAdmin.from('owners').select('id', { count: 'exact', head: true }).eq('association_code', upperCode).or('status.neq.previous,status.is.null'),
  ])

  const workOrders = (woRows ?? []) as AssociationHubData['workOrders']
  const data: AssociationHubData = {
    code:           assocRow.association_code,
    name:           assocRow.association_name,
    units:          meta?.Numberofunits ?? null,
    type:           null,
    serviceType:    (assocRow as { service_type?: string | null }).service_type ?? null,
    ownersCount:    ownersCount ?? 0,
    bankAccounts:   (bankAccounts ?? []).map(a => ({ description: a.description, last4: a.last4, kind: a.kind, bankBalance: a.bankBalance, restricted: a.restricted })),
    board:          (boardRows ?? []) as AssociationHubData['board'],
    workOrders,
    budget:         (budget ?? []) as AssociationHubData['budget'],
    openWorkOrders: workOrders.filter(w => OPEN_WO_STATUSES.includes(w.status)).length,
    openInvoices:   invoiceCount ?? 0,
    docCount:       docCount ?? 0,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD"><AdminNav /></SiteHeader>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        {contactsFlagOn === true && (
          <div className="mb-4 rounded border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-semibold">⚠ CINC Contacts and Consent feature is ENABLED on this tenant.</div>
            <div className="mt-1">The v1 <code className="bg-red-100 px-1 rounded">associationWithProperty</code> endpoint the owner/board sync depends on is retired by CINC. If a sync fails, MAIA needs the v2 migration. See <code>CINC_API.md</code>.</div>
          </div>
        )}
        <AssociationHubClient data={data} />
      </main>
    </div>
  )
}
