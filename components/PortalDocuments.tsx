'use client'

// =====================================================================
// components/PortalDocuments.tsx
//
// Resident-portal documents — fetched from MAIA (not Drive) AFTER login,
// so signed download URLs never appear in the public page. Renders the
// current files grouped by category group, each a download link.
// =====================================================================

import { useEffect, useState } from 'react'
import { normalizePortalLang, portalStrings } from '@/lib/portal-i18n'

interface PortalDoc { id: string; category_label: string; filename: string; effective_date: string | null; download_url: string }
interface PortalDocGroup { group: string; docs: PortalDoc[] }

// publicOnly = the no-login public document list (only docs staff marked public),
// shown on the association's main page to everyone. Otherwise the full gated list.
export default function PortalDocuments({ assocCode, lang, publicOnly }: { assocCode: string; lang?: string; publicOnly?: boolean }) {
  const t = portalStrings(normalizePortalLang(lang))
  const [groups, setGroups] = useState<PortalDocGroup[] | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    const url = publicOnly
      ? `/api/portal/documents/public?assoc=${encodeURIComponent(assocCode)}`
      : `/api/portal/documents?assoc=${encodeURIComponent(assocCode)}`
    fetch(url, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { groups?: PortalDocGroup[] }) => setGroups(d.groups ?? []))
      .catch(() => { setErr(true); setGroups([]) })
  }, [assocCode, publicOnly])

  // A public list with nothing in it renders nothing (no empty-state noise on
  // the public landing). The gated list keeps its empty/loading messaging.
  if (publicOnly && groups !== null && groups.length === 0) return null

  return (
    <section className="section">
      <h2 className="section-title">{publicOnly ? t.publicDocsTitle : t.docsTitle}</h2>

      {groups === null && <p className="text-xs" style={{ color: 'var(--muted)' }}>{t.docsLoading}</p>}

      {groups !== null && groups.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
          {err ? t.docsUnavailable : t.docsEmpty}
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
                <div className="prow-btn">{t.download}</div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
