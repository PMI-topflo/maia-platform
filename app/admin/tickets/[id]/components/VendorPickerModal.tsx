// =====================================================================
// app/admin/tickets/[id]/components/VendorPickerModal.tsx
//
// Two-tier vendor picker:
//   - Top section: vendors flagged in CINC as servicing this assoc
//     (always shown when assocCode is provided).
//   - Bottom section: search box + scrollable list of every other
//     vendor in the tenant's CINC.
//
// Clicking a row selects; Save commits via PATCH /details. The outbox
// pushes the new VendorId to CINC's PATCH /workOrderDetails.
// =====================================================================

'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

interface Vendor {
  VendorId:   number
  VendorName: string
}

interface Props {
  ticketId:         number
  associationCode:  string | null
  currentVendorId:  number | null
  currentVendorName: string | null
  onClose:          (committed: boolean) => void
}

export default function VendorPickerModal(props: Props) {
  const router = useRouter()
  const [loading,         setLoading]         = useState(true)
  const [loadError,       setLoadError]       = useState<string | null>(null)
  const [forAssociation,  setForAssociation]  = useState<Vendor[]>([])
  const [allOthers,       setAllOthers]       = useState<Vendor[]>([])
  const [search,          setSearch]          = useState('')
  const [selected,        setSelected]        = useState<Vendor | null>(
    props.currentVendorId && props.currentVendorName
      ? { VendorId: props.currentVendorId, VendorName: props.currentVendorName }
      : null,
  )
  const [submitting,      setSubmitting]      = useState(false)
  const [submitError,     setSubmitError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const qs = props.associationCode ? `?assocCode=${encodeURIComponent(props.associationCode)}` : ''
      const res = await fetch(`/api/admin/cinc/vendors${qs}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setForAssociation(data.forAssociation ?? [])
      setAllOthers(data.allOthers ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [props.associationCode])

  useEffect(() => { void load() }, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/admin/work-orders/${props.ticketId}/details`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          vendor_id:   selected.VendorId,
          vendor_name: selected.VendorName,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Update failed')
      router.refresh()
      props.onClose(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const lc = search.trim().toLowerCase()
  const filteredOthers = lc
    ? allOthers.filter(v => v.VendorName.toLowerCase().includes(lc))
    : allOthers

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => !submitting && props.onClose(false)}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Reassign vendor</h2>
          <button
            onClick={() => !submitting && props.onClose(false)}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >×</button>
        </div>

        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 space-y-3 overflow-y-auto flex-1">
            {loading && <div className="text-sm text-gray-500">Loading vendors…</div>}
            {loadError && <div className="text-sm text-red-600">{loadError}</div>}

            {!loading && !loadError && (
              <>
                {selected && (
                  <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm text-blue-900">
                    Selected: <span className="font-semibold">{selected.VendorName}</span>
                    <span className="text-blue-700 ml-2 font-mono text-xs">#{selected.VendorId}</span>
                  </div>
                )}

                {props.associationCode && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Vendors for {props.associationCode}
                    </div>
                    {forAssociation.length === 0 ? (
                      <div className="text-xs text-gray-400 italic px-2 py-1">
                        No vendors flagged for this association in CINC.
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded divide-y divide-gray-100">
                        {forAssociation.map(v => (
                          <VendorRow
                            key={v.VendorId}
                            vendor={v}
                            selected={selected?.VendorId === v.VendorId}
                            onSelect={() => setSelected(v)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    {props.associationCode ? 'All other vendors' : 'All vendors'}
                  </div>
                  <input
                    type="search"
                    placeholder="Search vendors…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2 focus:outline-none focus:border-[#f26a1b]"
                  />
                  <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-64 overflow-y-auto">
                    {filteredOthers.length === 0 ? (
                      <div className="text-xs text-gray-400 italic px-3 py-2">No matches.</div>
                    ) : (
                      filteredOthers.map(v => (
                        <VendorRow
                          key={v.VendorId}
                          vendor={v}
                          selected={selected?.VendorId === v.VendorId}
                          onSelect={() => setSelected(v)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            )}

            {submitError && <div className="text-xs text-red-600">{submitError}</div>}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg shrink-0">
            <button
              type="button"
              onClick={() => props.onClose(false)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
            >Cancel</button>
            <button
              type="submit"
              disabled={submitting || !selected || selected.VendorId === props.currentVendorId}
              className="bg-[#f26a1b] text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-[#d85a14] disabled:opacity-50"
            >{submitting ? 'Saving…' : 'Reassign'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function VendorRow({ vendor, selected, onSelect }: { vendor: Vendor; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50',
        selected ? 'bg-blue-50' : '',
      ].join(' ')}
    >
      <span className={selected ? 'font-semibold text-blue-900' : 'text-gray-800'}>
        {vendor.VendorName}
      </span>
      <span className="font-mono text-[10px] text-gray-400">#{vendor.VendorId}</span>
    </button>
  )
}
