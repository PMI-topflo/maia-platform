// =====================================================================
// /apply/[assoc]/guide — public, unauthenticated landing page for the
// Application Guide PDF. No login, no form; a server component (no client
// JS needed) that reads the same live data the PDF route renders, so the
// on-page headline facts and the PDF never disagree.
// =====================================================================

import { notFound } from 'next/navigation'
import { buildApplicationGuideData } from '@/lib/application-guide-data'

export const dynamic = 'force-dynamic'

export default async function ApplicationGuidePage({ params }: { params: Promise<{ assoc: string }> }) {
  const { assoc } = await params
  const data = await buildApplicationGuideData(assoc)
  if (!data) notFound()

  const m = data.masthead
  const pdfUrl = `/api/apply/application-guide/${data.associationCode}`

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f4', display: 'flex', justifyContent: 'center', padding: '48px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 640, width: '100%' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '32px 28px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <p style={{ font: '700 11px system-ui', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>Application Guide</p>
          <h1 style={{ font: '700 24px system-ui', color: '#0d0d0d', margin: '6px 0 4px' }}>{m.legalName}</h1>
          <p style={{ font: '13px system-ui', color: '#6b7280', margin: '0 0 16px' }}>{m.address} · {m.statute}</p>
          <p style={{ font: '15px system-ui', color: '#1f2937', lineHeight: 1.5, margin: '0 0 24px' }}>{m.dek}</p>

          <a href={pdfUrl} style={{ display: 'inline-block', font: '700 14px system-ui', color: '#fff', background: '#f26a1b', textDecoration: 'none', borderRadius: 8, padding: '12px 22px' }}>
            📄 Download the Application Guide (PDF)
          </a>

          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #f0f0f0' }}>
            <p style={{ font: '700 12px system-ui', color: '#1f2937', margin: '0 0 8px' }}>What&apos;s inside</p>
            <ul style={{ font: '13.5px system-ui', color: '#4b5563', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
              <li>Eligibility rules and restrictions, grouped by application type</li>
              <li>The step-by-step application process, including fees</li>
              <li>The full document checklist — lease, renewal, purchase, and additional occupant</li>
              <li>What&apos;s registered separately after your approval (gate access, club ID, etc.)</li>
            </ul>
          </div>
        </div>
        <p style={{ font: '12px system-ui', color: '#9ca3af', textAlign: 'center', marginTop: 16 }}>
          PMI Top Florida Properties · Ready to apply? Your agent or the office can send you a personal application link.
        </p>
      </div>
    </div>
  )
}
