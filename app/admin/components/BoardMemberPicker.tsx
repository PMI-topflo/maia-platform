'use client'

// BoardMemberPicker — checkbox list of the configured committee for a
// given association + approval purpose (application/invoice/estimate),
// each tagged Decider/Voter. Defaults to the whole committee selected;
// staff can narrow the send to a subset. Shared by EstimatesComparison,
// the invoice "Send for Board Approval" modal, and the applications
// send-to-board trigger.

import { useEffect, useState } from 'react'

interface CommitteeMember {
  id: string
  name: string
  role: string | null
  memberType: 'decider' | 'voter'
}

export default function BoardMemberPicker({
  associationCode,
  purpose,
  value,
  onChange,
  label = 'Committee',
}: {
  associationCode: string
  purpose: 'application' | 'invoice' | 'estimate'
  value: string[]
  onChange: (ids: string[]) => void
  label?: string
}) {
  const [members, setMembers] = useState<CommitteeMember[] | null>(null)

  useEffect(() => {
    let live = true
    setMembers(null)
    fetch(`/api/admin/board-approval-members?code=${encodeURIComponent(associationCode)}&purpose=${purpose}`)
      .then(r => r.json())
      .then((d: { ok: boolean; members?: { id: string; name: string; role: string | null; member_type: 'decider' | 'voter' | null }[] }) => {
        if (!live) return
        if (!d.ok) { setMembers([]); return }
        const committee = (d.members ?? [])
          .filter((m): m is typeof m & { member_type: 'decider' | 'voter' } => !!m.member_type)
          .map(m => ({ id: m.id, name: m.name, role: m.role, memberType: m.member_type }))
        setMembers(committee)
        onChange(committee.map(m => m.id))
      })
      .catch(() => { if (live) setMembers([]) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [associationCode, purpose])

  if (members === null) return <div className="text-xs text-gray-400">Loading committee…</div>
  if (members.length === 0) {
    return <div className="text-xs text-amber-600">No committee configured for {purpose} approval — set it up in Board Setup.</div>
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      {members.map(m => (
        <label key={m.id} className="flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={value.includes(m.id)}
            onChange={e => onChange(e.target.checked ? [...value, m.id] : value.filter(x => x !== m.id))}
          />
          {m.name}
          <span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${m.memberType === 'decider' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {m.memberType === 'decider' ? 'DECIDER' : 'VOTER'}
          </span>
          {m.role ? <span className="text-gray-400">({m.role})</span> : null}
        </label>
      ))}
    </div>
  )
}
