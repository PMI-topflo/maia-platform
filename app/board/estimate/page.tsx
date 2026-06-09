// /board/estimate?token= — login-free board approval of a vendor estimate.
// Public route (token-gated by the API). Server reads the token; the client
// fetches the approval + comparison and handles approve / request revision.
import EstimateApprovalClient from './EstimateApprovalClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Estimate approval — PMI Top Florida Properties' }

export default async function BoardEstimatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  if (!token) {
    return <div style={{ maxWidth: 560, margin: '60px auto', padding: 24, fontFamily: 'Helvetica,Arial,sans-serif', color: '#374151' }}>This approval link is missing its token.</div>
  }
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', fontFamily: 'Helvetica,Arial,sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Maia <span style={{ color: '#e85d26' }}>&#10022;</span></div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>by PMI Top Florida Properties</div>
      </div>
      <EstimateApprovalClient token={token} />
    </div>
  )
}
