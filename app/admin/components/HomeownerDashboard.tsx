'use client'

import { useState, useCallback, useTransition, useRef } from 'react'
import { Owner, Association, getOwners, deleteOwner } from '../actions'
import EditModal from './EditModal'

const PAGE_SIZE = 50

type Props = {
  associations: Association[]
  initialOwners: Owner[]
  initialTotal: number
}

export default function HomeownerDashboard({ associations, initialOwners, initialTotal }: Props) {
  const [owners, setOwners] = useState<Owner[]>(initialOwners)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [assocFilter, setAssocFilter] = useState('')
  const [editOwner, setEditOwner] = useState<Owner | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchOwners = useCallback((p: number, s: string, a: string) => {
    startTransition(async () => {
      const result = await getOwners(p, s, a)
      setOwners(result.owners)
      setTotal(result.total)
      setPage(p)
    })
  }, [])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchOwners(1, value, assocFilter), 300)
  }

  const handleAssocChange = (value: string) => {
    setAssocFilter(value)
    fetchOwners(1, search, value)
  }

  const handlePageChange = (p: number) => {
    fetchOwners(p, search, assocFilter)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSaved = () => {
    setEditOwner(null)
    setShowAdd(false)
    fetchOwners(page, search, assocFilter)
  }

  const handleDelete = async (owner: Owner) => {
    if (!confirm(`Delete ${owner.first_name} ${owner.last_name}? This cannot be undone.`)) return
    await deleteOwner(owner.id)
    fetchOwners(page, search, assocFilter)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search name, email, phone, unit, account #…"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={assocFilter}
          onChange={e => handleAssocChange(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-48"
        >
          <option value="">All Associations</option>
          {associations.map(a => (
            <option key={a.association_code} value={a.association_code}>
              {a.association_code} — {a.association_name.length > 45 ? a.association_name.slice(0, 45) + '…' : a.association_name}
            </option>
          ))}
        </select>

        <button
          onClick={() => setShowAdd(true)}
          className="text-sm font-medium bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          + Add Homeowner
        </button>
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {isPending ? 'Loading…' : `${total.toLocaleString()} homeowner${total !== 1 ? 's' : ''}`}
          {assocFilter && ` in ${assocFilter}`}
        </p>
        {totalPages > 1 && (
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Account #</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Association</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Unit</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Address</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className={isPending ? 'opacity-50' : ''}>
              {owners.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">
                    No homeowners found
                  </td>
                </tr>
              ) : (
                owners.map((owner, i) => (
                  <tr
                    key={owner.id}
                    className={`border-b border-gray-100 hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                      {owner.account_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {[owner.first_name, owner.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block text-xs font-medium bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                        {owner.association_code ?? '—'}
                      </span>
                      <span className="block text-xs text-gray-400 mt-0.5 max-w-[180px] truncate">
                        {owner.association_name ?? ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {owner.unit_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      <div className="max-w-[180px]">
                        {[owner.street_number, owner.address].filter(Boolean).join(' ') || '—'}
                        {owner.city && <span className="block text-gray-400">{owner.city}, {owner.state} {owner.zip_code}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {owner.phone ?? owner.phone_e164 ?? '—'}
                      {owner.phone_2 && <span className="block text-gray-400">{owner.phone_2}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[160px] truncate">
                      {owner.emails ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={owner.verified_status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditOwner(owner)}
                          className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(owner)}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            ← Prev
          </button>
          {paginationRange(page, totalPages).map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="px-2 text-gray-400">…</span>
            ) : (
              <button
                key={p}
                onClick={() => handlePageChange(p as number)}
                className={`px-3 py-1.5 text-sm border rounded-lg transition-colors ${
                  p === page
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      {/* Edit modal */}
      {editOwner && (
        <EditModal
          owner={editOwner}
          associations={associations}
          onClose={() => setEditOwner(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Add modal */}
      {showAdd && (
        <EditModal
          owner={null}
          associations={associations}
          onClose={() => setShowAdd(false)}
          onSaved={handleSaved}
        />
      )}
    </>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    verified: 'bg-green-50 text-green-700',
    pending: 'bg-yellow-50 text-yellow-700',
    inactive: 'bg-gray-100 text-gray-500',
  }
  const s = status ?? 'pending'
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${map[s] ?? 'bg-gray-100 text-gray-600'}`}>
      {s}
    </span>
  )
}

function paginationRange(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  if (current > 3) pages.push('...')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}
