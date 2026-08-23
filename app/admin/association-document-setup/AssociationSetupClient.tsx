'use client'

import { useState } from 'react'
import AssociationDocumentSetupBody from './AssociationDocumentSetupClient'
import AssociationApplicationRulesBody from './AssociationApplicationRulesClient'

// One page, not two tabs — user direction, 2026-08-23: "I want to see all in
// one page not 2 tabs with Documents requirement and Application rules."
// The association selector lives here, once, shared by both sections below.
export default function AssociationSetupClient({ associations }: { associations: Array<{ association_code: string; association_name: string }> }) {
  const [assoc, setAssoc] = useState('')
  const inputCls = 'rounded border border-gray-300 px-3 py-2 text-sm'

  return (
    <div className="space-y-6">
      <select value={assoc} onChange={e => setAssoc(e.target.value)} className={inputCls + ' w-full'}>
        <option value="">Select an association…</option>
        {associations.map(a => <option key={a.association_code} value={a.association_code}>{a.association_name} ({a.association_code})</option>)}
      </select>

      {assoc && (
        <>
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Document requirements</h2>
            <AssociationDocumentSetupBody assoc={assoc} />
          </section>

          <section className="border-t border-gray-200 pt-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Application rules</h2>
            <AssociationApplicationRulesBody assoc={assoc} />
          </section>
        </>
      )}
    </div>
  )
}
