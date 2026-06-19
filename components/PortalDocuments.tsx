'use client'

// =====================================================================
// components/PortalDocuments.tsx
//
// Resident-portal documents — fetched from MAIA (not Drive) AFTER login,
// so signed download URLs never appear in the public page. Renders the
// current files grouped by category group, each a download link.
// =====================================================================

import { useEffect, useState } from 'react'

interface PortalDoc { id: string; category_label: string; filename: string; effective_date: string | null; download_url: string }
interface PortalDocGroup { group: string; docs: PortalDoc[] }

export default function PortalDocuments({ assocCode }: { assocCode: string }) {
  const [groups, setGroups] = useState<PortalDocGroup[] | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    fetch(`/api/portal/documents?assoc=${encodeURIComponent(assocCode)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { groups?: PortalDocGroup[] }) => setGroups(d.groups ?? []))
      .catch(() => { setErr(true); setGroups([]) })
  }, [assocCode])

  return (
    <section className="section">
      <h2 className="section-title">Association Documents</h2>

      {groups === null && <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading documents…</p>}

      {groups !== null && groups.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          {err ? 'Documents are temporarily unavailable.' : 'No documents have been published for this association yet. They will appear here as your management team uploads them.'}
        </p>
      )}

      {(groups ?? []).map(g => (
        <div key={g.group} style={{ marginBottom: '1.25rem' }}>
          <div className="sh" style={{ marginTop: '0.5rem' }}>
            <div className="sh-t">{g.group}</div>
            <div className="sh-line" />
          </div>
          <div className="prow-grid">
            {g.docs.map(doc => (
              <a key={doc.id} href={doc.download_url} target="_blank" rel="noreferrer" className="prow">
                <div className="prow-orb">📄</div>
                <div className="prow-info">
                  <div className="prow-t">{doc.category_label}</div>
                  <div className="prow-d">{doc.filename}{doc.effective_date ? ` · ${doc.effective_date}` : ''}</div>
                </div>
                <div className="prow-btn">Download</div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
