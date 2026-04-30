import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const metadata = { title: 'Ownership History — PMI Top Florida' }
export const dynamic  = 'force-dynamic'

interface OwnerRecord {
  id: number
  first_name: string | null
  last_name:  string | null
  entity_name: string | null
  association_code: string
  association_name: string | null
  unit_number: string | null
  status: string | null
  ownership_start_date: string | null
  ownership_end_date:   string | null
  transferred_to:   string | null
  transferred_from: string | null
  emails: string | null
  phone:  string | null
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function ownerName(r: OwnerRecord) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.entity_name || '—'
}

export default async function OwnershipHistoryPage() {
  const { data: rows } = await supabaseAdmin
    .from('owners')
    .select('id, first_name, last_name, entity_name, association_code, association_name, unit_number, status, ownership_start_date, ownership_end_date, transferred_to, transferred_from, emails, phone')
    .order('association_code', { ascending: true })
    .order('unit_number',      { ascending: true })
    .order('ownership_start_date', { ascending: false })
    .limit(2000)

  const owners = (rows ?? []) as OwnerRecord[]

  // Group by (association_code + unit_number)
  const groups = new Map<string, OwnerRecord[]>()
  for (const row of owners) {
    const key = `${row.association_code}||${row.unit_number ?? ''}`
    const arr = groups.get(key) ?? []
    arr.push(row)
    groups.set(key, arr)
  }

  // Units with at least one previous owner
  const transferUnits = [...groups.entries()].filter(([, rows]) =>
    rows.some(r => r.status === 'previous')
  )
  // All other units
  const stableUnits = [...groups.entries()].filter(([, rows]) =>
    rows.every(r => r.status !== 'previous')
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        <AdminNav />
      </SiteHeader>

      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Ownership History</h1>
          <p className="text-sm text-gray-500 mt-1">Full timeline of all unit ownership transfers. {transferUnits.length} units with transfers, {groups.size} total units.</p>
        </div>

        {transferUnits.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
            No ownership transfers recorded yet. They appear here automatically when MAIA processes a new owner for an existing unit.
          </div>
        )}

        {/* Transferred units */}
        {transferUnits.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Units with Transfer History ({transferUnits.length})</h2>
            <div className="space-y-4">
              {transferUnits.map(([key, unitRows]) => {
                const current  = unitRows.find(r => r.status !== 'previous')
                const previous = unitRows.filter(r => r.status === 'previous')
                const sample   = unitRows[0]
                return (
                  <div key={key} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5 flex items-center gap-3">
                      <span className="font-semibold text-sm text-gray-800">{sample.association_name ?? sample.association_code}</span>
                      {sample.unit_number && (
                        <span className="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded font-mono">Unit {sample.unit_number}</span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">{unitRows.length} owner{unitRows.length !== 1 ? 's' : ''}</span>
                    </div>

                    <div className="divide-y divide-gray-50">
                      {current && (
                        <div className="flex items-start gap-3 px-4 py-3">
                          <div className="mt-1 w-2 h-2 rounded-full bg-green-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-900">{ownerName(current)}</span>
                              <span className="bg-green-100 text-green-700 text-[10px] font-semibold px-2 py-0.5 rounded uppercase">Current Owner</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 space-x-3">
                              {current.emails && <span>{current.emails}</span>}
                              {current.phone  && <span>{current.phone}</span>}
                              {current.ownership_start_date && <span>Since {fmtDate(current.ownership_start_date)}</span>}
                              {current.transferred_from && <span className="text-amber-600">↩ from {current.transferred_from}</span>}
                            </div>
                          </div>
                        </div>
                      )}

                      {previous.map(prev => (
                        <div key={prev.id} className="flex items-start gap-3 px-4 py-3 opacity-60">
                          <div className="mt-1 w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-600 line-through">{ownerName(prev)}</span>
                              <span className="bg-gray-100 text-gray-500 text-[10px] font-semibold px-2 py-0.5 rounded uppercase">Previous Owner</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 space-x-3">
                              {prev.emails && <span>{prev.emails}</span>}
                              {prev.ownership_start_date && <span>{fmtDate(prev.ownership_start_date)}</span>}
                              {prev.ownership_end_date && <span>→ {fmtDate(prev.ownership_end_date)}</span>}
                              {prev.transferred_to && <span className="text-blue-500">→ {prev.transferred_to}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Stable units — collapsed summary */}
        {stableUnits.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Stable Units — No Transfer History ({stableUnits.length})</h2>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Association</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Owner</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Since</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stableUnits.map(([key, unitRows]) => {
                    const r = unitRows[0]
                    return (
                      <tr key={key} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{r.association_name ?? r.association_code}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{r.unit_number ?? '—'}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{ownerName(r)}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{r.emails ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(r.ownership_start_date)}</td>
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
