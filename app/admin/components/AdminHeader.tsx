'use client'

import { useState } from 'react'
import AdminNav from './AdminNav'
import AddPersonModal from './AddPersonModal'

interface Props {
  associations: Array<{ association_code: string; association_name: string }>
}

export default function AdminHeader({ associations }: Props) {
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <AdminNav />
        <button
          onClick={() => setShowModal(true)}
          className="text-white border border-[#f26a1b]/60 hover:border-[#f26a1b] hover:bg-[#f26a1b]/10 [font-family:var(--font-mono)] text-[0.6rem] uppercase tracking-[0.08em] px-3 py-1.5 rounded-[2px] transition-colors ml-2"
        >
          + Add New Person
        </button>
      </div>

      {showModal && (
        <AddPersonModal
          associations={associations}
          onClose={() => setShowModal(false)}
          onAdded={() => window.location.reload()}
        />
      )}
    </>
  )
}
