// =====================================================================
// /board-certification/[token] — login-free BOARD MEMBER certificate upload.
// A board member uploads their DBPR board-education Certificate of Completion
// (and/or signed Board Member Certification Form). Token-gated; public route
// (not in the middleware matcher).
// =====================================================================

import { verifyBoardCertToken } from '@/lib/board-cert-token'
import PortalFormHeader from '@/components/PortalFormHeader'
import BoardCertUploadClient from './BoardCertUploadClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Board education certificate — PMI Top Florida' }

export default async function BoardCertPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = await verifyBoardCertToken(token)

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: '32px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <PortalFormHeader />
        {valid
          ? <BoardCertUploadClient token={token} />
          : <p style={{ fontSize: 14, color: '#991b1b' }}>This link is invalid or has expired. Please ask PMI for a new link.</p>}
      </div>
    </div>
  )
}
