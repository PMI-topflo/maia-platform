// =====================================================================
// app/admin/reconciliation/page.tsx
// Bank reconciliation page — replaces Isabela's manual Google-Sheet
// workflow. Pick assoc + bank account + month; see auto-synced CINC
// payments + manual entries side by side; edit notes / mark reconciled;
// download CSV at month-end.
//
// Server component loads the association list + bank-account map; the
// client component handles selection, edits, manual entries, sync,
// and CSV download.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import ReconciliationView from './components/ReconciliationView'

export const metadata = { title: 'Reconciliation — PMI Top Florida' }
export const dynamic  = 'force-dynamic'

interface SP {
  assoc?:   string
  account?: string
  month?:   string
}

interface PageProps {
  searchParams: Promise<SP>
}

export default async function ReconciliationPage({ searchParams }: PageProps) {
  const sp = await searchParams

  // Pull the association catalog from Supabase — we render dropdowns
  // client-side and the assoc list rarely changes. Bank-account list
  // per assoc is fetched lazily by the client component.
  const { data: assocs } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name')
    .order('association_code', { ascending: true })

  const initialAssoc   = typeof sp.assoc   === 'string' ? sp.assoc.toUpperCase() : ''
  const initialAccount = typeof sp.account === 'string' ? sp.account             : ''
  const initialMonth   = typeof sp.month   === 'string'
    ? sp.month
    : (() => {
        // Default to the current calendar month so the page opens on
        // "what Isabela is working through right now."
        const now = new Date()
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
      })()

  return (
    <>
      <SiteHeader />
      <AdminNav />
      <ReconciliationView
        associations={(assocs ?? []).map(a => ({
          code: (a as { association_code: string; association_name: string }).association_code,
          name: (a as { association_code: string; association_name: string }).association_name,
        }))}
        initialAssoc={initialAssoc}
        initialAccount={initialAccount}
        initialMonth={initialMonth}
      />
    </>
  )
}
