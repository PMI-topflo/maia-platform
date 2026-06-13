'use client'

// =====================================================================
// ComplianceHubClient.tsx — the Compliance Hub.
//   • Documents & Compliance: upload zone (MAIA reads + files after review)
//     + association picker → that association's full document set (present /
//     missing, with the filed file) via ComplianceMatrix (Sunbiz included).
//   • Units: the existing unit-level lease / insurance / CoU / violation
//     table (passed in pre-rendered).
// =====================================================================

import { useState } from 'react'
import Link from 'next/link'
import DocumentInboxClient, { type AssocOpt } from '../documents/inbox/DocumentInboxClient'
import ComplianceMatrix from '../cinc-sync/[code]/ComplianceMatrix'
import AssociationUnitDocs from './AssociationUnitDocs'

type Tab = 'docs' | 'units'

export default function ComplianceHubClient({
  associations, initialAssociation, unitsView,
}: {
  associations: AssocOpt[]
  initialAssociation: string | null
  unitsView: React.ReactNode
}) {
  const [tab, setTab] = useState<Tab>('docs')
  const [assoc, setAssoc] = useState<string>(initialAssociation ?? '')

  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-gray-200">
        <TabBtn active={tab === 'docs'} onClick={() => setTab('docs')}>Documents &amp; Compliance</TabBtn>
        <TabBtn active={tab === 'units'} onClick={() => setTab('units')}>Units (lease / insurance / CoU)</TabBtn>
      </div>

      {tab === 'units' ? unitsView : (
        <div className="space-y-6">
          {/* Upload zone — MAIA reads each, suggests where it files, you confirm. */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Upload documents</h2>
            <DocumentInboxClient associations={associations} />
          </section>

          {/* Association document set */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-900">Association documents</h2>
              <select
                value={assoc}
                onChange={e => setAssoc(e.target.value)}
                className="rounded border border-gray-300 px-2.5 py-1.5 text-sm"
              >
                <option value="">Pick an association…</option>
                {associations.map(a => <option key={a.code} value={a.code}>{a.name} ({a.code})</option>)}
              </select>
              {assoc && (
                <Link href="/admin/sunbiz" className="text-xs font-medium text-[#c2410c] hover:underline">Open Sunbiz tracker →</Link>
              )}
            </div>

            {assoc
              ? <ComplianceMatrix key={assoc} assocCode={assoc} />
              : <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">Pick an association to see its full document set — what&apos;s on file (with the document) and what&apos;s missing, including Sunbiz, insurance, DBPR, tax and more.</p>}
          </section>

          {assoc && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Unit / owner documents</h2>
              <AssociationUnitDocs key={assoc} assocCode={assoc} />
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${active ? 'border-[#f26a1b] text-[#c2410c]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
    >
      {children}
    </button>
  )
}
