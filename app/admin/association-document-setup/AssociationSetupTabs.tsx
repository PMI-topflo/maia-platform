'use client'

import { useState, type ReactNode } from 'react'

export default function AssociationSetupTabs({ documentSetup, applicationRules }: { documentSetup: ReactNode; applicationRules: ReactNode }) {
  const [tab, setTab] = useState<'docs' | 'rules'>('docs')

  const tabCls = (active: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${active ? 'border-[#f26a1b] text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        <button onClick={() => setTab('docs')} className={tabCls(tab === 'docs')}>Document requirements</button>
        <button onClick={() => setTab('rules')} className={tabCls(tab === 'rules')}>Application rules</button>
      </div>
      {tab === 'docs' ? documentSetup : applicationRules}
    </div>
  )
}
