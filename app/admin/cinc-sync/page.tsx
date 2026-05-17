import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listAllCincAssociations, type CincAssociationMeta } from '@/lib/integrations/cinc'
import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import OnboardButton from './OnboardButton'

export const metadata = { title: 'CINC Sync — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function CincSyncIndexPage() {
  const cookieStore = await cookies()
  const token       = cookieStore.get(SESSION_COOKIE)?.value
  const session     = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') redirect('/')

  const { data: associations } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name, service_type')
    .order('association_name')

  // Quick count of owners + board per assoc so staff can see scale before clicking in
  const { data: ownerCounts } = await supabaseAdmin
    .from('owners')
    .select('association_code')
    .or('status.neq.previous,status.is.null')
  const { data: boardCounts } = await supabaseAdmin
    .from('association_board_members')
    .select('association_code')
    .eq('active', true)
  // Per-association count of CURRENT (non-archived) governing documents
  // — answers "does this association have Condo Docs + Rules uploaded
  // yet?" at a glance so staff can spot gaps without clicking in.
  const { data: docCounts } = await supabaseAdmin
    .from('association_documents')
    .select('association_code')
    .is('archived_at', null)

  const ownerByCode: Record<string, number> = {}
  for (const o of (ownerCounts ?? [])) {
    if (o.association_code) ownerByCode[o.association_code] = (ownerByCode[o.association_code] ?? 0) + 1
  }
  const boardByCode: Record<string, number> = {}
  for (const b of (boardCounts ?? [])) {
    if (b.association_code) boardByCode[b.association_code] = (boardByCode[b.association_code] ?? 0) + 1
  }
  const docsByCode: Record<string, number> = {}
  for (const d of (docCounts ?? [])) {
    if (d.association_code) docsByCode[d.association_code] = (docsByCode[d.association_code] ?? 0) + 1
  }

  // Pull CINC's master list and compute the diff CINC \ MAIA so staff
  // can see at a glance which associations exist upstream but haven't
  // been onboarded yet. Failures (timeout, auth error) don't block the
  // page — the existing MAIA list still renders so the page degrades
  // gracefully instead of going blank when CINC is down.
  //
  // Filter out CINC rows where isActive === false. CINC keeps stale
  // associations marked inactive (old sample data, decommissioned
  // communities, etc.) and surfacing those as onboarding candidates
  // would just clutter the page. Rows where isActive is null/missing
  // are kept — that's CINC's "unknown" state, not a confirmed
  // inactive flag.
  let cincOnly: CincAssociationMeta[] = []
  let cincError: string | null = null
  try {
    const cincAssociations = await listAllCincAssociations()
    const maiaCodes        = new Set((associations ?? []).map(a => a.association_code.toUpperCase()))
    cincOnly = cincAssociations
      .filter(c => c.AssocCode && c.isActive !== false && !maiaCodes.has(c.AssocCode.toUpperCase()))
      .sort((a, b) => a.AssociationName.localeCompare(b.AssociationName))
  } catch (err) {
    cincError = err instanceof Error ? err.message : String(err)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <header className="mb-6 border-l-4 border-[#f26a1b] pl-4">
          <h1 className="text-xl font-semibold text-gray-900">CINC Sync</h1>
          <p className="text-sm text-gray-500 mt-1">
            Compare each association&apos;s owners and board members against CINC. Click an association to see a side-by-side diff and selectively apply changes.
          </p>
        </header>

        {/* CINC-only section — associations that exist upstream but
            aren't onboarded in MAIA. The two-step onboarding flow:
              1. Click ONBOARD here  → creates the MAIA associations row
                                       and lands you on the diff page.
              2. On the diff page    → pick the owners + board members to
                                       import (same flow as everyday sync). */}
        {cincError && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800">
            Could not fetch the CINC association list ({cincError}). The MAIA list below still works — refresh later to retry.
          </div>
        )}

        {cincOnly.length > 0 && (
          <section className="mb-6 bg-white border-2 border-[#f26a1b]/30 rounded-lg overflow-hidden">
            <div className="bg-[#f26a1b]/5 border-b border-[#f26a1b]/20 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900 [font-family:var(--font-mono)] uppercase tracking-wide">
                Available in CINC — not yet onboarded ({cincOnly.length})
              </h2>
              <p className="text-xs text-gray-600 mt-1 leading-snug">
                These associations exist in CINC but have no MAIA row yet. <strong>Onboarding flow:</strong> (1) click <span className="text-[#f26a1b] font-mono">+ Onboard</span> to create the association in MAIA — (2) you land on the diff page — (3) tick the owners + board members you want to import and click Apply. After that the association behaves like every other one in the list below.
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">CINC Code</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Association (CINC name)</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">CINC Units</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Active</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {cincOnly.map(c => (
                  <tr key={c.AssocCode} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{c.AssocCode}</td>
                    <td className="px-4 py-2 text-gray-800">{c.AssociationName}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{c.Numberofunits ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {c.isActive === false
                        ? <span className="text-[10px] uppercase font-semibold text-gray-400">Inactive</span>
                        : <span className="text-[10px] uppercase font-semibold text-green-700">Yes</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <OnboardButton assocCode={c.AssocCode} assocName={c.AssociationName} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Code</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Association</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Service</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Owners</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Board</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Docs</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2 [font-family:var(--font-mono)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(associations ?? []).map(a => (
                <tr key={a.association_code} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{a.association_code}</td>
                  <td className="px-4 py-2 text-gray-800">{a.association_name}</td>
                  <td className="px-4 py-2 text-center">
                    <ServiceTypeBadge serviceType={a.service_type} />
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">{ownerByCode[a.association_code] ?? 0}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{boardByCode[a.association_code] ?? 0}</td>
                  <td className="px-4 py-2 text-center">
                    <DocsCountBadge count={docsByCode[a.association_code] ?? 0} />
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/admin/cinc-sync/${a.association_code}/documents`}
                      className="text-indigo-700 hover:text-indigo-900 hover:underline text-xs font-mono uppercase tracking-wide mr-3"
                    >
                      📄 Docs
                    </Link>
                    <Link
                      href={`/admin/cinc-sync/${a.association_code}`}
                      className="text-[#f26a1b] hover:underline text-xs font-mono uppercase tracking-wide"
                    >
                      Compare →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Small presentational helpers — kept in this file because they only
// matter to the cinc-sync index. service_type values come from the
// associations table; we normalize the freeform string into the two
// abbreviations staff actually use ("FM" vs "BK").
// ─────────────────────────────────────────────────────────────────────

function ServiceTypeBadge({ serviceType }: { serviceType: string | null | undefined }) {
  const norm = (serviceType ?? '').toLowerCase()
  // "full management" → FM; "bookkeeping" / "financial only" → BK.
  // Anything else (or NULL) renders blank so it stands out as
  // "needs classification" rather than mislabeling.
  let label = ''
  let style = ''
  if (norm.includes('full') || norm === 'fm' || norm.includes('full management')) {
    label = 'FM'
    style = 'bg-emerald-100 text-emerald-800 border-emerald-300'
  } else if (norm.includes('bookkeep') || norm === 'bk' || norm.includes('financial only')) {
    label = 'BK'
    style = 'bg-amber-100 text-amber-800 border-amber-300'
  }
  if (!label) {
    return <span className="text-[10px] text-gray-300 font-mono uppercase">—</span>
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wide border ${style}`}>
      {label}
    </span>
  )
}

function DocsCountBadge({ count }: { count: number }) {
  // Color-code: 0 docs = red (missing), 1 doc = amber (half-set —
  // probably only Condo Docs OR Rules), 2+ = green (both uploaded).
  // This is a quick visual gap-spotting tool for staff.
  const color = count === 0
    ? 'bg-red-100 text-red-700 border-red-300'
    : count === 1
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : 'bg-green-100 text-green-800 border-green-300'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wide border ${color}`}>
      {count}
    </span>
  )
}
