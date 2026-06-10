import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const metadata = { title: 'Tenancy History — PMI Top Florida' }
export const dynamic  = 'force-dynamic'

interface TenantRecord {
  id:                  number
  first_name:          string | null
  last_name:           string | null
  email:               string | null
  phone:               string | null
  association_code:    string
  association_name:    string | null
  unit_number:         string | null
  status:              string | null
  lease_start_date:    string | null
  lease_end_date:      string | null
  transferred_to:      string | null
  transferred_from:    string | null
  added_by:            string | null
  rentvine_contact_id: string | null
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function tenantName(r: TenantRecord) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || '—'
}

function statusBadge(status: string | null) {
  switch (status) {
    case 'active':
      return { dot: 'bg-green-400', label: 'Active', labelClass: 'bg-green-100 text-green-700' }
    case 'previous':
      return { dot: 'bg-gray-300', label: 'Previous', labelClass: 'bg-gray-100 text-gray-500' }
    case 'expired':
      return { dot: 'bg-red-300', label: 'Expired', labelClass: 'bg-red-100 text-red-600' }
    default:
      return { dot: 'bg-yellow-300', label: status ?? 'Unknown', labelClass: 'bg-yellow-100 text-yellow-700' }
  }
}

export default async function TenancyHistoryPage() {
  const { data: rows } = await supabaseAdmin
    .from('association_tenants')
    .select('id, first_name, last_name, email, phone, association_code, association_name, unit_number, status, lease_start_date, lease_end_date, transferred_to, transferred_from, added_by, rentvine_contact_id')
    .order('association_code',  { ascending: true })
    .order('unit_number',       { ascending: true })
    .order('lease_start_date',  { ascending: false })
    .limit(2000)

  const tenants = (rows ?? []) as TenantRecord[]

  // Group by (association_code + unit_number)
  const groups = new Map<string, TenantRecord[]>()
  for (const row of tenants) {
    const key = `${row.association_code}||${row.unit_number ?? ''}`
    const arr = groups.get(key) ?? []
    arr.push(row)
    groups.set(key, arr)
  }

  const transferUnits = [...groups.entries()].filter(([, rows]) =>
    rows.some(r => r.status === 'previous' || r.status === 'expired')
  )
  const stableUnits = [...groups.entries()].filter(([, rows]) =>
    rows.every(r => r.status !== 'previous' && r.status !== 'expired')
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Tenancy History</h1>
          <p className="text-sm text-gray-500 mt-1">
            Full timeline of all unit tenancies. {transferUnits.length} units with transition history, {groups.size} total units.
          </p>
        </div>

        {groups.size === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
            No tenant records yet. They appear here automatically when MAIA processes a new tenant for a unit.
          </div>
        )}

        {/* Units with transition history */}
        {transferUnits.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Units with Tenancy Transitions ({transferUnits.length})
            </h2>
            <div className="space-y-4">
              {transferUnits.map(([key, unitRows]) => {
                const current  = unitRows.find(r => r.status === 'active')
                const past     = unitRows.filter(r => r.status !== 'active')
                const sample   = unitRows[0]
                return (
                  <div key={key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center gap-3">
                      <span className="font-semibold text-sm text-gray-800">
                        {sample.association_name ?? sample.association_code}
                      </span>
                      {sample.unit_number && (
                        <span className="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded font-mono">
                          Unit {sample.unit_number}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">
                        {unitRows.length} tenant{unitRows.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="divide-y divide-gray-50">
                      {current && (() => {
                        const badge = statusBadge(current.status)
                        return (
                          <div className="flex items-start gap-3 px-4 py-3">
                            <div className={`mt-1 w-2 h-2 rounded-full ${badge.dot} shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm text-gray-900">{tenantName(current)}</span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${badge.labelClass}`}>
                                  {badge.label}
                                </span>
                                {current.added_by === 'rentvine_sync' && (
                                  <span className="bg-purple-50 text-purple-600 text-[10px] font-semibold px-2 py-0.5 rounded uppercase">Rentvine</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5 space-x-3">
                                {current.email && <span>{current.email}</span>}
                                {current.phone && <span>{current.phone}</span>}
                                {current.lease_start_date && <span>Since {fmtDate(current.lease_start_date)}</span>}
                                {current.lease_end_date   && <span>Ends {fmtDate(current.lease_end_date)}</span>}
                                {current.transferred_from && <span className="text-amber-600">↩ from {current.transferred_from}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })()}

                      {past.map(prev => {
                        const badge = statusBadge(prev.status)
                        return (
                          <div key={prev.id} className="flex items-start gap-3 px-4 py-3 opacity-55">
                            <div className={`mt-1 w-2 h-2 rounded-full ${badge.dot} shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm text-gray-600 line-through">{tenantName(prev)}</span>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${badge.labelClass}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5 space-x-3">
                                {prev.email && <span>{prev.email}</span>}
                                {prev.lease_start_date && <span>{fmtDate(prev.lease_start_date)}</span>}
                                {prev.lease_end_date   && <span>→ {fmtDate(prev.lease_end_date)}</span>}
                                {prev.transferred_to   && <span className="text-blue-500">→ {prev.transferred_to}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Stable units */}
        {stableUnits.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Active Tenants — No Transition History ({stableUnits.length})
            </h2>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Association</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tenant</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lease Start</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lease End</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stableUnits.map(([key, unitRows]) => {
                    const r     = unitRows[0]
                    const badge = statusBadge(r.status)
                    return (
                      <tr key={key} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{r.association_name ?? r.association_code}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{r.unit_number ?? '—'}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">
                          <div className="flex items-center gap-2">
                            {tenantName(r)}
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${badge.labelClass}`}>{badge.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{r.email ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(r.lease_start_date)}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(r.lease_end_date)}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">
                          {r.added_by === 'rentvine_sync' ? (
                            <span className="bg-purple-50 text-purple-600 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase">Rentvine</span>
                          ) : r.added_by === 'maia' ? (
                            <span className="bg-blue-50 text-blue-600 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase">MAIA</span>
                          ) : (
                            <span className="text-gray-400">{r.added_by ?? '—'}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
